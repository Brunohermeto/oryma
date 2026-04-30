'use client'
import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'

interface UploadResult {
  file: string
  orderId?: string
  items?: number
  error?: string
}

export function NFEUploadZone({ onUploadComplete }: { onUploadComplete?: () => void }) {
  const [uploading, setUploading] = useState(false)
  const [results, setResults] = useState<UploadResult[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return
    setUploading(true)
    setResults([])

    const form = new FormData()
    Array.from(files).forEach(f => form.append('files', f))

    const res = await fetch('/api/nfe/upload', { method: 'POST', body: form })
    const data = await res.json()
    setResults(data.results ?? [])
    setUploading(false)
    if (data.ok) onUploadComplete?.()
  }

  const successCount = results.filter(r => !r.error).length
  const errorCount = results.filter(r => r.error).length

  return (
    <div className="space-y-3">
      <div
        className="border-2 border-dashed border-slate-200 rounded-xl p-8 text-center hover:border-blue-400 hover:bg-blue-50/30 transition-colors cursor-pointer"
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xml"
          multiple
          className="hidden"
          onChange={e => handleFiles(e.target.files)}
        />
        <div className="text-3xl mb-2">📄</div>
        <p className="text-sm font-medium text-gray-600">
          {uploading ? 'Processando XMLs...' : 'Arraste arquivos XML aqui ou clique para selecionar'}
        </p>
        <p className="text-xs text-gray-400 mt-1">NF-e de entrada (importações) — múltiplos arquivos suportados</p>
      </div>

      {results.length > 0 && (
        <div className="space-y-1.5">
          {successCount > 0 && (
            <div className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg px-4 py-2">
              ✓ {successCount} NF-e{successCount > 1 ? 's' : ''} importada{successCount > 1 ? 's' : ''} com sucesso
            </div>
          )}
          {results.filter(r => r.error).map((r, i) => (
            <div key={i} className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-2">
              ✗ {r.file}: {r.error}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
