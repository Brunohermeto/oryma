// Feedback instantâneo ao navegar — sem isso o clique parece "morto"
// enquanto o servidor monta a página.
export default function DashboardLoading() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 py-32">
      <div
        className="w-8 h-8 rounded-full animate-spin"
        style={{ border: '3px solid oklch(0.90 0.02 258)', borderTopColor: '#125BFF' }}
      />
      <div className="text-sm" style={{ color: 'oklch(0.50 0.025 258)' }}>Carregando…</div>
    </div>
  )
}
