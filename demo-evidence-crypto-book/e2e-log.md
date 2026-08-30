# 加密申报账本 Demo — Live E2E Log (2026-08-30, UTC)

Persona（虚构，补齐"来源模式 × 资产类别"矩阵的最后一格：**申报持仓的
Crypto**）：*"我重仓了 BTC（0.75 个），还有 6 个 ETH、160 个 SOL 和 18,000
USDT。目标仓位大概 40/25/20/15。币圈波动太快，帮我 24 小时盯着，有大事
再叫我。"* 模式：申报持仓 + 目标 + 稳定币现金（rung C），零阻塞问题。
Skill: portfolio-watch v5（含 phase5 官方 schema 校准的 declared-cash 与
language 显式配置修正）。

| 时间 (UTC) | 步骤 | 证据 |
|---|---|---|
| 09:5x | Preflight：credits 24,269；现有 automation 清单核对（无 crypto 申报账本 watch，不构成重复建）；新鲜端点发现 `data-skills list → summary → endpoint`：`crypto/binance/spot/usdt/kline`（symbol 传基础币非交易对；**时间戳为 RFC 3339 字符串**——与股票端点的 Unix 秒不同口径，进判断模块前统一 parse；官方指引 σ 用 population 口径，本引擎照做并注明） | — |
| 10:0x | **共享判断引擎第二实例** `demo-crypto-book/judgment.js`：A 股语义（涨跌停/除权/T+1/会话门）→ crypto 语义（24/7 每次运行都判断、24h 滚动 σ 慢车道 + 1h 快车道方向状态制、USDC/USDT 交叉盘脱锚两次确认+滞回复位、回撤 episode——顺带补上 v2 crypto demo 记录在案的盲区）。**离线断言 38/38**（8 组：静默基线/慢车道/快车道/稳定币纪律/脱锚/漂移重武装/回撤 episode/大盘折叠/降级/播种/测试管道） | 01, 02 |
| 10:0x | 测试驱动出一处引擎改进：**残差告警加"自身 ≥1σ 在动"门**——否则单币暴涨会给没动的币各发一条"落后残差"告警（1 个事件 → N 条通知，正是残差声音要修的敞口问题）。振荡守卫行为也被测试钉死：重武装后 24h 内再突破按设计压制（6.4a/6.4b 双断言） | 01, 02 |
| 10:1x | **手动 run 1**（`alva run` 非送达）：NAV $107,957（真实行情 BTC $78,000）；eff_bets 2.06/3、60 日相关性 0.83；bootstrap 把 day-one 状态（BTC 出带 +14pp、ETH 出带 −11pp）**静默播种，零告警** | 04, 05 |
| 10:1x | **手动 run 2**：NAV 序列 2 行、KV 指纹延续、novelty 安静（digest 0）；**故障注入**：ZZZFAKECOIN → `unpriced/stale`、不入 NAV、零告警、不崩溃；持仓还原 | 04 |
| 10:14 | `deploy create` → cronjob **32246**，cron `0 * * * *`（每小时 24/7——加密没有会话窗口，与美股/A 股 demo 的市场时段 cron 形成三口径对照），`push_notify: true`；`automation publish` → feed **27876**，owner ACTIVE binding 自动建立（ch 5025），发布自动首跑绿且安静（digest 0——门在生产送达语义下守住） | 07, 08, 14 |
| 10:1x | **四门逐项验证**：alertOutput 已声明 ✓ / push_notify ✓ / ACTIVE binding ✓ / routing isEnabled → ch 5025 ✓（email enabled=false available=false 如实记录：web 是唯一 *available* 通道——enabled≠available 两态检查即 phase5 校准落地） | 08, 09 |
| 10:2x | Playbook：中文页面（快慢双车道列、稳定币行、目标带偏离、告警时间线空态文案）；lint **0/0/0**；draft（playbook 9003）；feed 公开（虚构 persona 账本，页面显著声明）；**v1.0.0 发布**；截图门通过（NAV/持仓/出带标记全部真实渲染） | 10–13 |
| 10:2x | **v1.0.1 发布**：description 按 showcase v2.0.2 的归档教训改写为访客视角大白话（初衷 + 页面替你看的四件事 + "没消息就是好消息"）；config 写入 playbook 深链（digest 带"打开 Playbook"按钮）。页面 HTML 与判断逻辑无变化 | — |

## 本 demo 独有的展示点

1. **矩阵闭合**：连账户 crypto（demo 1）、bare watchlist 美股（demo 2）、
   申报 A 股（demo 3）、**申报 crypto（本 demo）**——同一份 SKILL.md 吃进
   四种输入形态，"资产无关核心 + 资产模块"不再是主张而是四次执行记录。
2. **共享引擎的可移植性证明**：第二个资产实例只替换市场语义层
   （涨跌停+T+1 → 24/7+快车道+脱锚），新颖度门/指纹/episode 状态机
   一行未改；38 断言与实盘共享同一份判断代码。
3. **24/7 语义一等公民**：无收盘锚 → 24h 滚动窗；快车道方向状态制
   （持续下跌响一次，不逐小时轰炸）；脱锚两次确认 + 交叉盘方向模糊性
   如实写进告警文案。
4. **phase5 校准的修正在实战使用**：declared cash（USDT 仓入 NAV、压回撤、
   永不告警）、language 显式配置（config.json `"language": "zh"`）、
   送达 enabled≠available 两态检查。

## Definition of done — status

- [x] 来源解析：4/4 资产（3 crypto + 1 stable）各自解析到唯一定价路径，零阻塞问题
- [x] Producer 手动跑两次；run 2 消费 run 1 历史（KV 延续、novelty 安静）
- [x] 故障注入：unpriced/stale、告警抑制、不崩溃
- [x] Automation 上线（每小时 cron）；发布自动首跑绿且安静
- [x] Playbook v1.0.1 发布：lint 0/0/0、截图门过、README 如实、深链生效
- [x] 送达四门逐项验证（binding ACTIVE、routing → ch 5025；email 如实记录为 unavailable）
- [ ] 送达 `sent` 行：待自然产生——同账户同机制已两度证明（crypto demo 08-25、
      equity 08-27 3×sent 对账一致），本 automation 不再消耗受控触发；
      首条真实告警产生时按 `alert history` 的 sent 行核验
- [x] 离线断言 38/38 与实盘共享同一份判断代码

## Cost

手动 runs 3 次（`alva run` 计 0 credit）+ 发布自动首跑 1 credit + 截图。
调度成本：24 runs/天 × 1 credit。

Share link: <https://alva.ai/u/lx79d/playbooks/portfolio-watch-crypto-book>
