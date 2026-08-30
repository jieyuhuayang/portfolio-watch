# 提交说明（SUBMISSION）

## 200 字介绍（HR 邮件用）

这份作品是一个可直接安装的 Alva Agent Skill：说一句 "keep an eye on my
NVDA, TSLA, and AAPL, ping me when something big happens"（题目原句）或
"watch my Binance portfolio"，都能得到一个真实运行的 Playbook——会话感知
刷新的界面 + σ 标定、novelty 门控、带深链按钮的告警管线。它在真实 Alva
平台端到端跑通了**三次**：crypto 组合（告警一次且仅一次送达）、美股
watchlist（题目原句、零阻塞、财报日真实告警）、重仓中际旭创的 A 股
showcase（涨跌停/除权语义、板块残差、页面内嵌 12 个月回放且三次证伪了
自己的规则设计——最后一次证伪的是回放本身：现与线上告警共享同一份判断
代码并有离线测试套件）。资产无关核心 + equity/crypto 模块 + 三种来源模式（连账户 /
报持仓 / 只报 ticker），每个平台调用对照真实 CLI/SDK 校准。三轮行为评测：
v3 63/63，裸跑 42/63，v2 在受重构影响场景 13/19 vs v3 19/19。设计核心是
三个承诺：数字必须真实、沉默必须是信息、页面必须活着（ONE-PAGER.md）。

## 链接清单

- 仓库：`portfolio-watch/`（git 历史按阶段组织，可直接公开）
- **Showcase：重仓中际旭创的 A 股风险 watch（第一性原理演示，公开）**：
  <https://alva.ai/u/lx79d/playbooks/portfolio-watch-showcase>
  ——有效押注数 1.6/4、板块 leave-one-out β/残差、系统性折叠、涨跌停与
  除权语义、漂移带、页面内嵌 12 个月回放（两次证伪：滞回 + 除权识别）
- **美股 watchlist demo（题目原句构建，公开）**：
  <https://alva.ai/u/lx79d/playbooks/portfolio-watch-equity-demo>
- **加密申报账本 demo（矩阵第四格：申报持仓 × crypto，公开）**：
  <https://alva.ai/u/lx79d/playbooks/portfolio-watch-crypto-book>
  ——共享判断引擎第二资产实例（38 断言）；24/7 快慢双车道、稳定币脱锚
  两次确认、回撤 episode、大盘联动折叠
- Crypto share-safe 公开 demo（canonical）：
  <https://alva.ai/u/lx79d/playbooks/portfolio-watch-demo-safe>
- Crypto 私有原版（owner 视角）：
  <https://alva.ai/u/lx79d/playbooks/portfolio-watch-demo>
- One-pager：`ONE-PAGER.md`（EN）/ `ONE-PAGER.zh.md`（中文）
- 端到端证据：`demo-evidence/`（crypto 连账户）、`demo-evidence-equity/`（美股）、`demo-evidence-ashare/`（A 股 showcase）、`demo-evidence-crypto-book/`（加密申报账本）
- 真机校准表：`calibration.md`
- 评测报告：`evals/iteration-{1,2,3}-results.md`
- 产品设计说明（中文，深度版）：`DESIGN.md`

## 已知未闭环项（如实陈述）——已于 2026-08-30 核验闭环

原未闭环项：美股 demo 的告警送达 sent 行在初次提交时点未出现（当时判定为
平台侧新 automation 的 fanout 问题，四门已逐项就绪，详见
`demo-evidence-equity/15-delivery-diagnostics.txt` 与 DESIGN.md §12.3）。

**后续闭环（08-27 真实行情，08-30 只读核验）**：NVDA 财报次日的三条真实
告警（盘中 +7.0%/3.3σ → 盘中 +9.0%/4.3σ → 收盘 +8.7% 定锚）全部送达
（`alert history` 三条 `status: "sent"`），digest↔sent 逐条对账一致 ——
3 条发布前验证行（非送达 `alva run`）正确地没有 sent 行，3 条调度运行行
逐一对应（`demo-evidence-equity/16-delivery-sent-rows.json`）。当时的判定
被证实：fanout 缺口是平台侧且短暂的；skill 坚持"无 sent 行不得报送达"
让记录在平台自证之前保持了诚实。A 股 showcase 同期 0 告警 0 送达，经
核验为真实安静（29 次运行全绿、digest 计数 0，
`demo-evidence-ashare/18-quiet-runs-delivery-state.jsonl`）——
"沉默即信息"双向成立。
