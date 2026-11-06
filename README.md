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
npm test           # 20 testes: física solar + diagnósticos ponta a ponta
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
│               diagnostics-panel, string-health, weekly-chart, losses-chart, thermal-chart
├── features/   plant-monitoring (pipeline + store), plant-diagnostics (algoritmos),
│               sun-control (bússola, modo manual × tempo real), language-switch
├── entities/   plant (config + modelo físico), weather (Open-Meteo + fallback), telemetry
└── shared/     lib/solar (física pura), lib/time, api/http (Axios), i18n, ui (EChart, Panel)
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

Cenário de demonstração (em `entities/telemetry/api/simulatedSource.ts`): 34 dias sem
limpeza, string **B3** com −13 % há 4 dias, e **desarme do INV-B por sobretensão** há 3 dias.
Os testes confirmam que os algoritmos encontram **exatamente** essas falhas e nenhum falso
positivo numa usina saudável.

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
