'use client'
import { useEffect } from 'react'

/**
 * Modo demonstração: borra todo texto que contenha dígitos (valores, datas,
 * quantidades) em toda a plataforma. Reaplica em cada re-render/navegação.
 */
export function DemoBlur() {
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = '.demo-blur{filter:blur(6px)!important;user-select:none!important}'
    document.head.appendChild(style)

    const apply = () => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      let node: Node | null
      while ((node = walker.nextNode())) {
        const el = node.parentElement
        if (!el || el.classList.contains('demo-blur')) continue
        const tag = el.tagName
        if (tag === 'SCRIPT' || tag === 'STYLE') continue
        if (/\d/.test(node.textContent ?? '')) el.classList.add('demo-blur')
      }
    }
    apply()
    // classList.add é mutação de atributo — não observada, então não gera loop
    const mo = new MutationObserver(apply)
    mo.observe(document.body, { childList: true, subtree: true, characterData: true })
    return () => { mo.disconnect(); style.remove() }
  }, [])

  return (
    <div style={{
      position: 'fixed', bottom: 12, left: '50%', transform: 'translateX(-50%)',
      zIndex: 9999, background: '#0B1023', color: '#fff', padding: '6px 16px',
      borderRadius: 999, fontSize: 12, fontWeight: 600, boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
    }}>
      Modo demonstração — valores ocultos
    </div>
  )
}
