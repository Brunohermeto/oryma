'use client'

// Tela de erro do dashboard. Existe pra falha de banco aparecer COMO FALHA:
// antes, consulta quebrada virava lista vazia e a Visão Geral mostrava o mês
// zerado — parecia perda de dados (incidente de 22/09/2026).
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-xl font-semibold">Não foi possível carregar os números</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        A consulta ao banco de dados falhou. Os valores <strong>não</strong> são zero —
        eles simplesmente não puderam ser lidos agora.
      </p>
      <code className="max-w-md break-words rounded bg-muted px-3 py-2 text-xs">
        {error.message}
      </code>
      <button
        onClick={reset}
        className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
      >
        Tentar de novo
      </button>
    </div>
  )
}
