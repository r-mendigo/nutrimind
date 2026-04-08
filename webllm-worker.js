// webllm-worker.js - WebLLM Web Worker
import * as webllm from "https://esm.run/@mlc-ai/web-llm";

let engine = null;
let isGenerating = false;

self.onmessage = async (e) => {
    const { type, payload } = e.data;

    switch (type) {
        case "INIT":
            try {
                engine = await webllm.CreateMLCEngine(
                    payload.model || "Llama-3.2-3B-Instruct-q4f16_1-MLC",
                    {
                        initProgressCallback: (report) => {
                            self.postMessage({
                                type: "PROGRESS",
                                payload: report,
                            });
                        },
                    },
                );
                self.postMessage({ type: "READY" });
            } catch (err) {
                self.postMessage({ type: "ERROR", payload: err.message });
            }
            break;

        case "GENERATE":
            if (!engine) {
                self.postMessage({ type: "ERROR", payload: "Engine not initialized" });
                return;
            }

            isGenerating = true;

            try {
                const stream = await engine.chat.completions.create({
                    messages: payload.messages,
                    temperature: payload.temperature || 0.35,
                    top_p: payload.top_p || 0.9,
                    max_tokens: payload.max_tokens || 520,
                    stream: true,
                });

                let fullResponse = "";

                for await (const chunk of stream) {
                    if (!isGenerating) break; // Check for stop request

                    const delta = chunk.choices?.[0]?.delta?.content || "";
                    if (!delta) continue;

                    fullResponse += delta;

                    self.postMessage({
                        type: "CHUNK",
                        payload: {
                            delta: delta,
                            full: fullResponse,
                        },
                    });
                }

                self.postMessage({
                    type: "COMPLETE",
                    payload: fullResponse,
                });
            } catch (err) {
                self.postMessage({ type: "ERROR", payload: err.message });
            }

            isGenerating = false;
            break;

        case "STOP":
            isGenerating = false;
            if (engine) {
                try {
                    await engine.interruptGenerate();
                } catch (e) {
                    // Ignore interrupt errors
                }
            }
            self.postMessage({ type: "STOPPED" });
            break;

        case "RESET":
            // Terminate this worker - main thread will create a new one
            isGenerating = false;
            engine = null;
            self.postMessage({ type: "RESET_COMPLETE" });
            self.close();
            break;

        default:
            self.postMessage({ type: "ERROR", payload: "Unknown message type" });
    }
};