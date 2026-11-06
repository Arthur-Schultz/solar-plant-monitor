import axios from 'axios'

/** Instância Axios compartilhada: timeout curto e mensagens de erro normalizadas. */
export const http = axios.create({ timeout: 12_000 })

http.interceptors.response.use(
  (r) => r,
  (error) => {
    const reason =
      error?.response?.data?.reason ?? error?.message ?? 'Falha de rede desconhecida'
    return Promise.reject(new Error(reason))
  },
)
