/* 聊天框组件 - 底部消息输入和展示（支持折叠与 Markdown 渲染） */
import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ChatMessage } from '../types'

interface Props {
  messages: ChatMessage[]
  onSend: (messages: ChatMessage[]) => void
}

export function ChatBox({ messages, onSend }: Props) {
  const [input, setInput] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function handleSend() {
    const text = input.trim()
    if (!text) return
    const newMsg: ChatMessage = { role: 'user', content: text }
    const updated = [...messages, newMsg]
    onSend(updated)
    setInput('')
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // 自动调整输入框高度
  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
  }

  return (
    <div className="border-t border-gray-200 bg-white shrink-0">
      {/* 折叠/展开控制栏 */}
      <div
        className="flex items-center justify-between px-4 py-1.5 cursor-pointer select-none hover:bg-gray-50 transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <svg
            className={`w-3.5 h-3.5 transition-transform ${collapsed ? '' : 'rotate-180'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
          <span>AI 助手</span>
          {!collapsed && messages.length > 0 && (
            <span className="text-gray-400">（{messages.length} 条消息）</span>
          )}
        </div>
        {collapsed && messages.length > 0 && (
          <span className="text-xs text-gray-400">{messages.length} 条消息</span>
        )}
      </div>

      {/* 消息列表（可折叠） */}
      {!collapsed && messages.length > 0 && (
        <div className="max-h-60 overflow-y-auto custom-scrollbar px-4 py-2 space-y-1.5 border-b border-gray-100">
          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-lg px-3 py-1.5 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-100 text-gray-800'
                }`}
              >
                {msg.role === 'assistant' && msg.content ? (
                  <div className="prose prose-sm prose-gray max-w-none prose-headings:text-gray-800 prose-headings:font-semibold prose-p:my-0.5 prose-p:leading-relaxed prose-ul:my-0.5 prose-ol:my-0.5 prose-table:text-xs prose-th:bg-gray-200 prose-th:px-2 prose-th:py-1 prose-td:px-2 prose-td:py-1 prose-code:text-blue-700 prose-code:bg-blue-100 prose-code:px-1 prose-code:rounded prose-pre:bg-gray-200 prose-pre:text-gray-800">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.content}
                    </ReactMarkdown>
                  </div>
                ) : msg.content ? (
                  <span className="whitespace-pre-wrap">{msg.content}</span>
                ) : msg.role === 'assistant' ? (
                  <span className="cursor-blink" />
                ) : null}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}

      {/* 输入区（始终可见） */}
      <div className="flex items-end gap-2 p-3">
        <textarea
          ref={inputRef}
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
          placeholder="询问关于文档的问题... (Enter 发送, Shift+Enter 换行)"
          rows={1}
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
        />
        <button
          className="bg-blue-500 text-white rounded-lg px-4 py-2 text-sm hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
          disabled={!input.trim()}
          onClick={handleSend}
        >
          发送
        </button>
      </div>
    </div>
  )
}