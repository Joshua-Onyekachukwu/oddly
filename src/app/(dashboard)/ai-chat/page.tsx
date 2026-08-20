"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "@/providers/AuthProvider";
import { PageHeader, Badge } from "@/components/ui";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

const SUGGESTED_QUESTIONS = [
  "Who is the Crown Jewel pick today?",
  "What are the best value bets for Premier League this weekend?",
  "Analyze the Over 2.5 market for Arsenal vs Chelsea",
  "What does the model think about the Barcelona vs Real Madrid match?",
  "Show me today's highest edge predictions",
  "Explain how the opportunity score is calculated",
];

export default function AiChatPage() {
  const { profile, session } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const sendMessage = useCallback(async (text?: string) => {
    const question = text || input.trim();
    if (!question || loading) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: question,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setStreamingContent("");

    try {
      const response = await fetch("/api/v1/ai-chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
        },
        body: JSON.stringify({
          message: question,
          history: messages.slice(-6).map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let fullContent = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            try {
              const parsed = JSON.parse(data);
              if (parsed.error) throw new Error(parsed.error);
              if (parsed.done) break;
              if (parsed.chunk) {
                fullContent += parsed.chunk;
                setStreamingContent(fullContent);
              }
            } catch {
              // Skip invalid JSON lines
            }
          }
        }
      }

      if (fullContent) {
        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: fullContent,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Network error — please check your connection and try again.";

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `⚠️ ${errorMessage}`,
          timestamp: new Date(),
        },
      ]);
    }

    setStreamingContent("");
    setLoading(false);
  }, [input, loading, messages, session?.access_token]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const suggestedQs = messages.length === 0 ? SUGGESTED_QUESTIONS : [];

  return (
    <div className="flex flex-col h-[calc(100vh-100px)]">
      <PageHeader
        title="AI Analyst"
        description="Ask about predictions, value bets, match analysis, or model insights."
        action={
          <Badge variant="success" dot>
            Live
          </Badge>
        }
      />

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto space-y-[12px] mb-[12px] pr-[4px]">
        {messages.length === 0 && !streamingContent && (
          <div className="text-center py-[32px]">
            <div className="inline-flex items-center justify-center w-[48px] h-[48px] rounded-[12px] bg-gray-50 mb-[12px]">
              <i className="ri-robot-2-line text-[20px] text-gray-400" />
            </div>
            <h3 className="text-[15px] font-semibold text-[#0A0F1C] mb-[4px]">
              How can I help?
            </h3>
            <p className="text-[12px] text-gray-400 mb-[20px]">
              Ask me about today&apos;s picks, match analysis, or betting strategy.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-[6px] max-w-[480px] mx-auto">
              {suggestedQs.map((q, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(q)}
                  className="text-left p-[10px] bg-white rounded-[10px] border border-gray-100 text-[12px] text-gray-600 hover:border-gray-200 hover:bg-gray-50 transition-all duration-200"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-[12px] p-[12px] ${
                msg.role === "user"
                  ? "bg-[#1B2A4A] text-white"
                  : "bg-white border border-gray-100 text-[#0A0F1C]"
              }`}
            >
              {msg.role === "assistant" && (
                <div className="flex items-center gap-[6px] mb-[4px]">
                  <span className="w-[16px] h-[16px] bg-gray-100 rounded-full flex items-center justify-center">
                    <i className="ri-robot-2-line text-[9px] text-gray-500" />
                  </span>
                  <span className="text-[10px] font-semibold text-gray-400">ODDLY AI</span>
                </div>
              )}
              <div className="text-[13px] leading-[1.6] whitespace-pre-wrap">{msg.content}</div>
              <div
                className={`text-[10px] mt-[4px] ${
                  msg.role === "user" ? "text-white/40" : "text-gray-300"
                }`}
              >
                {msg.timestamp.toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>
          </div>
        ))}

        {/* Streaming response */}
        {streamingContent && (
          <div className="flex justify-start">
            <div className="max-w-[80%] bg-white border border-gray-100 rounded-[12px] p-[12px] text-[#0A0F1C]">
              <div className="flex items-center gap-[6px] mb-[4px]">
                <span className="w-[16px] h-[16px] bg-gray-100 rounded-full flex items-center justify-center">
                  <i className="ri-robot-2-line text-[9px] text-gray-500" />
                </span>
                <span className="text-[10px] font-semibold text-gray-400">ODDLY AI</span>
                <span className="w-[4px] h-[4px] bg-green-500 rounded-full animate-pulse ml-[2px]" />
              </div>
              <div className="text-[13px] leading-[1.6] whitespace-pre-wrap">{streamingContent}</div>
            </div>
          </div>
        )}

        {loading && !streamingContent && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-100 rounded-[12px] p-[12px]">
              <div className="flex items-center gap-[6px] mb-[4px]">
                <span className="w-[16px] h-[16px] bg-gray-100 rounded-full flex items-center justify-center">
                  <i className="ri-robot-2-line text-[9px] text-gray-500" />
                </span>
                <span className="text-[10px] font-semibold text-gray-400">ODDLY AI</span>
              </div>
              <div className="flex gap-[3px]">
                <span className="w-[5px] h-[5px] bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-[5px] h-[5px] bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-[5px] h-[5px] bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="bg-white rounded-[12px] border border-gray-100 shadow-[0_1px_8px_rgba(0,0,0,0.04)] p-[10px]">
        <div className="flex items-end gap-[8px]">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about today's picks, match analysis, or strategy..."
            rows={1}
            className="flex-1 resize-none text-[13px] text-[#0A0F1C] placeholder:text-gray-400 focus:outline-none min-h-[34px] max-h-[100px] py-[4px] px-[6px]"
          />
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading}
            className="w-[34px] h-[34px] rounded-[8px] bg-[#1B2A4A] text-white flex items-center justify-center transition-all duration-200 hover:bg-[#243B53] active:scale-[0.95] disabled:opacity-30 disabled:cursor-not-allowed flex-none"
          >
            <i className="ri-send-plane-fill text-[13px]" />
          </button>
        </div>
        <p className="text-[10px] text-gray-300 mt-[4px]">
          Unlimited questions
        </p>
      </div>
    </div>
  );
}
