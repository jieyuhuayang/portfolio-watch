# 提交说明（SUBMISSION）

## 200 字介绍（HR 邮件用）

这份作品是一个可直接安装的 Alva Agent Skill：用户说一句"watch my crypto
portfolio and alert me when something big happens"，就能得到一个真实运行的
Playbook——每小时刷新的持仓页面 + σ 标定、novelty 门控的告警管线。它已在
真实 Alva 平台端到端跑通：从一句话到发布 33 分钟、3 次交互，告警送达四条件
逐门验证、测试告警一次且仅一次送达，全程证据留存。Skill 的每个平台调用都
对照真实 CLI/SDK 校准（发现并修正了两处二手信息错误）；两轮行为评测中，
有 Skill 40/40，裸跑 26/40。设计核心是三个承诺：数字必须真实、沉默必须是
信息、页面必须活着——以及为守住它们而显性化的每一条产品取舍（DESIGN.md）。

## 链接清单

- 仓库：`portfolio-watch/`（git 历史按阶段组织，可直接公开）
- Share-safe 公开 demo（canonical）：
  <https://alva.ai/u/lx79d/playbooks/portfolio-watch-demo-safe>
- 私有原版（owner 视角）：
  <https://alva.ai/u/lx79d/playbooks/portfolio-watch-demo>
- 端到端证据：`demo-evidence/`（逐门命令输出、截图、e2e 时间线）
- 真机校准表：`calibration.md`
- 评测报告：`evals/iteration-1-results.md`、`evals/iteration-2-results.md`
- 产品设计说明（中文）：`DESIGN.md`
