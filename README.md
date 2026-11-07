# ☀️ Solar Plant Monitor

**Digital twin & SCADA-style monitoring for a 75 kWp solar PV plant** — React 19 · TypeScript · Three.js · ECharts

> 🇧🇷 Gêmeo digital e supervisão de usina solar fotovoltaica (UFV Rio do Peixe)

Sistema de supervisão, **gêmeo digital 3D** e **telemetria** para uma usina solar
fotovoltaica de microgeração de **75,2 kWp** em zona rural de Torreões, Juiz de Fora (MG).

> **Transparência:** a usina é uma **referência simulada** com parâmetros reais de mercado.
> O **clima é real** (Open-Meteo), a **geração esperada** vem de um modelo físico, e a
> **telemetria é simulada**, com falhas injetadas de propósito para que os diagnósticos
> tenham o que encontrar. A fonte de telemetria fica atrás de uma interface, então trocar
> por um coletor real (Modbus TCP, API do fabricante, CSV) não muda nenhuma tela.

## Stack

React 19 · TypeScript (strict) · Vite · Zustand 5 · Apache ECharts 6 · Three.js · Axios ·
i18next (pt-BR / en-US) · Vitest · arquitetura **Feature-Sliced Design**.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 46 testes: física solar, cada falha simulada, chuva, backend da IA
npm run build      # typecheck + bundle de produção em dist/
```

## A usina de referência

| Item | Valor |
|---|---|
| Módulos | 160 × 470 Wp mono PERC half-cell (γ Pmax = −0,34 %/°C, NOCT 45 °C) |
| Inversores | 2 × 30 kW trifásicos → 60 kW CA, razão CC/CA = 1,25 |
| Strings | 8 × 20 módulos (4 por inversor). **Cada string = uma mesa 2P×10** na maquete |
| Estrutura | Fixa no solo, face norte, inclinação ajustável de 5° a 40° (padrão 22°), passo de 7,5 m |
| Enquadramento | Microgeração distribuída (≤ 75 kW CA), Lei 14.300 / GD II |
| Economia | Cemig B2 rural ≈ R$ 0,88/kWh, 30 % de consumo simultâneo (ordenha/resfriador), Fio B 60 % em 2026. **Valores estimados**, configuráveis em `entities/plant/model/config.ts` |

## Arquitetura (Feature-Sliced Design)

```
src/
├── app/        Bootstrap, estilos globais, ciclo de vida do monitoramento
├── pages/      dashboard — compõe widgets, deriva KPIs e diagnósticos (useMemo)
├── widgets/    plant-twin (Three.js), generation-chart, kpi-strip, inverter-panel,
│               diagnostics-panel, string-health, weekly-chart, losses-chart, thermal-chart,
│               ai-assistant (chat + retrato do painel)
├── features/   plant-monitoring (pipeline + store), plant-diagnostics (algoritmos),
│               fault-injection (simulador de falhas), ai-assistant (store + API do chat),
│               sun-control (bússola, modo manual × tempo real), language-switch
├── entities/   plant (config + modelo físico), weather (Open-Meteo + fallback), telemetry
└── shared/     lib/solar (física pura), lib/time, api/http (Axios), i18n, ui (EChart, Panel, Markdown)
server/
└── assistant/  plugin Vite (rota /api/assistant), cliente Gemini SSE, prompt e validação
```

Regras seguidas: camadas só importam de camadas abaixo; entidades não se importam entre si.
O modelo da usina aceita um tipo estrutural `MeteoInput` em vez de importar `weather`, e o
simulador recebe a referência física por **injeção de dependência**.

### Fluxo de dados

```
Open-Meteo (horário) ──► reamostragem 15 min ──► modelo físico (usina limpa) ──► esperado
        │ falha/limite                                    │
        └──► clima sintético determinístico               └──► TelemetrySource ──► medido
                                                                    (simulador)
esperado × medido ──► diagnósticos ──► KPIs, gráficos, maquete 3D (cores por string)
```

## Modelo físico (`shared/lib/solar`)

1. **Posição do Sol**: algoritmo NOAA simplificado com refração de Bennett.
2. **Decomposição de Erbs**: GHI → DNI + DHI, quando a fonte só tem a global.
3. **Transposição isotrópica (Liu & Jordan)**: irradiância no plano dos módulos, com albedo.
   Evolução natural: modelo de Perez.
4. **Sombra entre fileiras**: geometria no plano de perfil. A fileira da frente não recebe sombra.
5. **Perda por reflexão (IAM ASHRAE)** em ângulos rasantes.
6. **Temperatura de célula (NOCT, com correção por vento)** e fator térmico `1 + γ·(Tc − 25)`.
7. **Inversor**: curva de eficiência por carga e **clipping** na potência nominal.

**Detalhe que pesa:** o Open-Meteo entrega a radiação como **média da hora anterior**. A
reamostragem interpola o **índice de céu claro** (não o GHI bruto), centrado no meio de cada
intervalo. Assim a curva em sino fica coerente no nascer e no pôr do sol.

## Diagnósticos automáticos (`features/plant-diagnostics`)

| Diagnóstico | Como funciona |
|---|---|
| **Sujeira** | Por dia, razão medido ÷ esperado só em intervalos com POA > 400 W/m² e inversores ligados, usando a **mediana entre strings**. Isso torna a estimativa imune a uma string com defeito e a desarmes. A perda vira R$/dia e "a limpeza se paga em N dias". |
| **String com desvio** | Cada string é comparada com o **próprio esperado**, que já inclui a sombra da sua fileira, e depois com a mediana do mesmo inversor. Comparar potência bruta daria falso positivo nas fileiras de trás. Também informa desde quando o desvio existe. |
| **Indisponibilidade** | Inversor com geração abaixo de 2 % enquanto o modelo esperava mais de 1,5 kW. Calcula energia e R$ perdidos. |
| **Perda térmica** | kWh perdidos por aquecimento e temperatura de pico da célula. |
| **Clipping** | Energia limitada pelo inversor, sinalizada como comportamento de projeto. |

O botão **Cenário demo** do simulador liga sujeira acumulando há 7 dias, hotspot na string
**B3** e **desarmes do INV-B por sobretensão** há 3 dias.

## Simulador de falhas (`entities/telemetry/model/faults.ts`)

Painel para ligar na mão 13 problemas reais de microgeração, em 4 grupos. Cada falha gera a
**assinatura** que o defeito real deixa nos dados, não só uma perda fixa:

| Grupo | Falhas | Como aparece nos dados |
|---|---|---|
| Sujeira e sombra | sujeira geral, sujeira localizada, sombra de vegetação, sombra de objeto | rampa de perda em todas as strings · perda constante numa string · perda só com Sol baixo · perda numa janela da tarde |
| Conexões e módulos | MC4 com mau contato, hotspot/trinca, string aberta | quedas intermitentes a zero · perda constante · tensão sem corrente |
| Inversor e rede | sobretensão na rede, derating, inversor desligado | desarmes repetidos no pico · CA limitado com CC normal · indisponibilidade contínua |
| Degradação e projeto | PID, envelhecimento, string com módulos a menos | todo o arranjo de um inversor abaixo · perda uniforme estável · tensão menor que as vizinhas |

**Chuva:** a chuva real do Open-Meteo e o evento "chuva forte" do simulador lavam parte da
sujeira (nada abaixo de 5 mm, até ~80 % acima de 35 mm). O diagnóstico reconhece a limpeza
natural ("a chuva de 32 mm recuperou ~4 % da geração") e, se houver chuva forte prevista
para as próximas 48 h, recomenda esperar antes de pagar a limpeza. A maquete 3D mostra
chuva com céu nublado quando chove (automático, ou pelo botão "Chuva").

Os diagnósticos **não leem** o cenário: classificam a causa só pela telemetria (horário da
perda, intermitência, tensão, eficiência de conversão). Um teste para cada falha garante que
ela é encontrada pela assinatura certa e que a usina saudável não gera falso positivo.

## Assistente IA (Google Gemini)

Chat lateral que responde **apenas sobre energia solar** e analisa os dados do painel.

- **Backend embutido no Vite** (`server/assistant/plugin.ts`): rota `POST /api/assistant`
  que chama o Gemini em streaming (SSE). A chave fica só no processo Node e nunca vai para o
  navegador.
- **Contexto**: a cada pergunta o navegador envia um retrato compacto do painel (KPIs,
  strings, inversores, diagnósticos já traduzidos, eventos, últimos dias). O cenário do
  simulador **não** é enviado: a IA precisa raciocinar pelos dados.
- **Escopo e segurança**: o prompt de sistema recusa assuntos fora de energia solar, trata os
  dados como dados (mitiga prompt injection), cita números do painel e sempre inclui
  orientações de segurança elétrica (NR-10). A entrada é validada e limitada no servidor.

### Configurar (grátis)

1. Crie uma chave em https://aistudio.google.com/apikey
2. Copie `.env.example` para `.env.local` e preencha `GEMINI_API_KEY=...`
3. Rode `npm run dev` (ou o `iniciar.bat`) e clique em **Assistente IA**

`GEMINI_MODEL` permite trocar o modelo (padrão `gemini-3.5-flash`). O `.env.local` já está no
`.gitignore`.

## Decisões de engenharia

- **Degradação graciosa**: sem API (offline, limite de requisições, CSP), o painel continua
  funcionando com clima sintético e avisa no cabeçalho. Há cache de 30 min em `localStorage`.
- **Determinismo**: o simulador usa um PRNG com semente (mulberry32), então o mesmo instante
  produz os mesmos dados e os testes são reprodutíveis.
- **Fuso horário explícito**: todo cálculo de "dia" usa `America/Sao_Paulo` via `Intl`, com
  memoização (a otimização derrubou o pipeline de 1,2 s para cerca de 40 ms).
- **Gráficos sem eixo Y duplo**: potência e irradiância ficam em painéis empilhados com o
  mesmo eixo de tempo. Cores validadas para daltonismo, e status sempre com ícone + texto.
- **Three.js puro** encapsulado numa classe (`PlantScene`) com `update(state)` e `dispose()`.
  O React só passa o estado. Câmera ortográfica isométrica, sombras do sol em tempo real,
  arco da trajetória solar do dia, seleção por clique sincronizada com tabela e diagnósticos.

## Próximos passos

- `ModbusTcpSource`: um pequeno gateway Node lê os registradores SunSpec do inversor e
  publica via WebSocket. A interface `TelemetrySource` já está pronta.
- Modelo de Perez, perdas por cabeamento e degradação anual dos módulos.
- Detecção de sujeira por regressão em dias de céu claro e calibração do modelo com
  dados reais.
- Alertas por e-mail/WhatsApp e histórico persistido (TimescaleDB).
