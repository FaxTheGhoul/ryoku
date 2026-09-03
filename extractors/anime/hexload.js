// ─── extractors/hexload.js ───────────────────────────────────────────────────
// Hexload no es un jwplayer/HTML5 <video> estándar (por eso el extractor
// "generico" -- que busca eso -- no lo resolvía). Es un player custom que,
// una vez cargada la página del embed, hace un POST por AJAX a /download con
// el "id" (el código después de "embed-" en la URL) y devuelve el link real
// del video en JSON -- reversado desde el panel Network del navegador:
//
//   GET  https://hexload.com/embed-0qx3cdcqrflf
//   POST https://hexload.com/download
//        body: op=download3&id=0qx3cdcqrflf&ajax=1&method_free=1&dataType=json
//   → { status:200, msg:"OK", result:{ url:"https://...mp4", content_type:"video/mp4", ... } }
'use strict'
const axios = require('axios')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// El id es el código alfanumérico de la URL del embed -- normalmente después
// de "embed-" (https://hexload.com/embed-0qx3cdcqrflf), pero por las dudas
// también se contempla el formato sin ese prefijo (/0qx3cdcqrflf a secas),
// como usan varios clones de este mismo player en otros dominios.
function extraerId(serverUrl) {
  let m = serverUrl.match(/embed-([a-zA-Z0-9]+)/)
  if (m) return m[1]
  m = serverUrl.match(/hexload\.[a-z.]+\/(?:e\/|embed\/)?([a-zA-Z0-9]{8,})/i)
  return m ? m[1] : null
}

async function getStream(serverUrl) {
  try {
    const id = extraerId(serverUrl)
    if (!id) return null
    const origin = new URL(serverUrl).origin

    const body = new URLSearchParams({
      op: 'download3',
      id,
      ajax: '1',
      method_free: '1',
      dataType: 'json',
    }).toString()

    const { data } = await axios.post(`${origin}/download`, body, {
      headers: {
        'User-Agent': UA,
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': serverUrl,
        'Origin': origin,
        'Accept': 'application/json, text/javascript, */*; q=0.01',
      },
      timeout: 15000,
    })

    const url = data?.result?.url
    if (!url || typeof url !== 'string') return null
    // El link real vive en un subdominio de CDN aparte (no hexload.com) --
    // varios de estos players exigen que el Referer sea el del propio sitio
    // del embed o rechazan/cuelgan la descarga en silencio. Se manda igual
    // que se usa acá arriba para pedir el link, por las dudas.
    return { tipo: url.toLowerCase().includes('.m3u8') ? 'm3u8' : 'mp4', url, referer: origin + '/' }
  } catch (e) {
    return null
  }
}

module.exports = { getStream }
