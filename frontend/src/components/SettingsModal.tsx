/* 设置弹窗 - 管理 API 和 PDF 配置 */
import { useState } from 'react'
import type { Settings } from '../types'
import { motion, AnimatePresence } from 'framer-motion'

interface Props {
  settings: Settings
  onSave: (settings: Settings) => void
  onClose: () => void
}

export function SettingsModal({ settings, onSave, onClose }: Props) {
  const [form, setForm] = useState<Settings>({ ...settings })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  function handleChange(key: keyof Settings, value: string) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    setSaving(true)
    setMessage(null)
    try {
      await onSave(form)
      setMessage({ type: 'success', text: '设置已保存' })
      setTimeout(onClose, 1000)
    } catch {
      setMessage({ type: 'error', text: '保存失败，请检查后端服务' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="bg-white rounded-xl shadow-2xl w-[480px] max-w-[90vw] max-h-[85vh] overflow-y-auto"
          onClick={e => e.stopPropagation()}
        >
          {/* 标题 */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-800">设置</h2>
            <button className="text-gray-400 hover:text-gray-600 text-xl" onClick={onClose}>×</button>
          </div>

          {/* 表单 */}
          <div className="p-5 space-y-4">
            {/* API 配置 */}
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">API Key</label>
              <input
                type="password"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                placeholder="sk-..."
                value={form.LLM_API_KEY}
                onChange={e => handleChange('LLM_API_KEY', e.target.value)}
              />
              <p className="text-xs text-gray-400">DeepSeek / OpenAI 兼容 API Key</p>
            </div>

            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">API 地址</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                placeholder="https://api.deepseek.com/v1"
                value={form.LLM_BASE_URL}
                onChange={e => handleChange('LLM_BASE_URL', e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">模型名称</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                  placeholder="deepseek-chat"
                  value={form.LLM_MODEL}
                  onChange={e => handleChange('LLM_MODEL', e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">温度</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                  value={form.LLM_TEMPERATURE}
                  onChange={e => handleChange('LLM_TEMPERATURE', e.target.value)}
                />
              </div>
            </div>

            {/* 分隔线 */}
            <div className="border-t border-gray-200 pt-4">
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700">PDF 文件路径</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-400"
                  placeholder="可选，留空自动检测同目录下 PDF"
                  value={form.PDF_PATH}
                  onChange={e => handleChange('PDF_PATH', e.target.value)}
                />
                <p className="text-xs text-gray-400">留空则自动检测项目目录下的所有 PDF 文件</p>
              </div>
            </div>

            {/* 提示消息 */}
            {message && (
              <div className={`text-sm px-3 py-2 rounded ${
                message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
              }`}>
                {message.text}
              </div>
            )}
          </div>

          {/* 操作按钮 */}
          <div className="flex justify-end gap-2 px-5 py-4 border-t border-gray-200 bg-gray-50">
            <button
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              onClick={onClose}
            >
              取消
            </button>
            <button
              className="px-4 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50"
              disabled={saving}
              onClick={handleSave}
            >
              {saving ? '保存中...' : '保存设置'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}