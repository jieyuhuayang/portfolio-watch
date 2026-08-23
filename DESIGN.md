# Portfolio Watch Skill — 产品设计说明

> Alva PM 笔试作品的设计文档。Skill 本体（`SKILL.md` + `references/`）是交付物；
> 本文解释**为什么这样设计**——每条规则背后的产品判断、取舍和验证方式。

## 1. 对题目的理解

题目：构建一个 Portfolio Watch Skill，让**任何用户**用它生成**带界面和 Alert 的
Playbook**。

我把它拆成三个隐含要求：

1. **"任何用户"** ⇒ Skill 必须处理入口的全部分布：已连 Binance 的、没连的、
   空仓的、只想问一句"今天怎么样"的。所以设计了意图路由（Answer / Build /
   Tune / Share / Remix）和四级降级阶梯（Rung A–D），并把"最多一个阻塞问题"
   写进规范——账户连接是唯一值得阻塞的问题，其余全部走默认值 + 事后可调。
2. **"带界面"** ⇒ 不是生成一张 HTML，而是履行 Playbook 的三个契约：数据契约
   （只读 Feed、无硬编码数字）、界面契约（十秒扫描顺序：现状→变化→可信度）、
   发布契约（lint、截图、README、可见性）。
3. **"带 Alert"** ⇒ 这是整个 Skill 的产品灵魂。Alert 的本质约束是：
   **沉默必须是信息**（没响=没事），否则用户很快静音，静音即流失。所以
   novelty gate、波动率标定阈值、分band去抖、升级才重报、每次运行合并成一条
   digest，全部服务于把 alert 渠道的信噪比钉在 100% 附近。

一个判断贯穿全部设计：**Portfolio Watch 不是页面，是管线**——
账户真值 → 有界历史 → 实质变化判断 → 安静为默认的通知 → 活的界面。
这正是 Alva 平台哲学（Feed 契约 / bounded history / semantic novelty /
发布硬门）在一个具体产品上的实例化。

## 2. 关键产品决策与理由

| 决策 | 备选 | 为什么这样选 |
|---|---|---|
| 波动率标定阈值（σ-scaled）而非固定百分比 | "涨跌超5%提醒" | 固定阈值对小币周周报警、对大币常年沉默。"异常"必须相对资产自身常态定义，否则 alert 质量随持仓结构崩坏 |
| 回撤按 band 触发（5/10/15/20/30%） | 连续阈值 | 在 -9.8%~-10.2% 震荡的组合只应报一次。band + cooldown 是去抖的最便宜实现 |
| 升级重报、恢复不报 | 对称通知 | 恶化是用户必须再次听到的；恢复放页面上。方向不对称是注意力经济学，不是漏功能 |
| depeg 需连续 2 次运行确认 | 单次触发 | critical 级 alert 的假阳性代价 > 1 小时延迟。数据毛刺不该推送"你的稳定币脱锚了" |
| 缺数据时压制该资产全部 alert | 照常判断 | API 返回 0 触发"暴跌"警报是对信任的一次性摧毁。宁可漏报也不误报涉及钱的坏消息 |
| 隐私默认 private；分享走 share-safe（只暴露比例，不暴露绝对值，且是数据层剥离而非 CSS 隐藏） | 默认可分享 | 持仓是财富数据。CSS 隐藏≠没给数据；页面没收到的数据才不会泄露 |
| Remix 分享方法、不分享数据（模板+lineage，绑定 remixer 自己的账户） | 分享整个 Playbook | 这是"任何用户"的规模化答案：Skill 一次造一个 watch，Remix 把最好的那个变成所有人的起点，同时守住数据边界 |
| 成本价不可得时不伪造 P&L，改用"自开始监控以来" | 估一个入场价 | 诚实的替代基准 > 编造的精确数字。金融产品里"看起来精确"是负资产 |
| 敏感度只暴露一个旋钮（calm/normal/sensitive），并告知预期频率 | 暴露全部参数 | 用户以性情思考，不以 σ 思考。"大约每周一两条"是用户能追责的承诺，阈值表不是 |
| 尘埃仓合并进 OTHER，永不单独报警 | 全量监控 | 40 个空投币不能变成 40 条 alert 流。会计上保留（NAV 要平），注意力上归零 |

## 3. 可靠性设计（工程同学最关心的部分）

- **写入顺序即故障语义**：数据先写、alert 次之、fingerprint 最后提交。中途
  崩溃的两种后果里，"罕见重复"可接受、"静默漏报"不可接受，顺序由此确定。
- **第二次运行才是测试**：调度前强制手跑两次，验证第二次能读到第一次的历史、
  novelty gate 能压住重复。状态类 bug 全部住在第二次运行里。
- **半盲不判断**：>50% NAV 数据陈旧时，本次运行只记账不判断，全量压制 alert。
- **连接断裂只报一次**（action-needed 级），之后安静降级到最后一次好快照 +
  显式 stale 横幅。每小时报"连不上"是用户卸载的原因，不是服务。
- **LLM 的笼子**：alpi 只做证据分类与综合（新闻 materiality + synopsis），
  输出是词不是数；任何用户可见的数字走 API → 算术 → Feed，不经过模型。

## 4. 指标设计

北极星：**周活跃且未静音的 watch 数**（Weekly Trusted Watches）。
"未静音"是关键限定——一个被静音的 watch 是尚未流失的流失。

| 层 | 指标 | 警戒信号 |
|---|---|---|
| Alert 质量 | 送达/静默比、打开率、点开后进入 Playbook 率、静音/关闭率 | 打开率下滑先于静音率上升，是最早的噪音信号 |
| 可信度 | stale 运行占比、false-alert 用户反馈数、无来源数字数（应恒为 0） | |
| 构建漏斗 | 意图→发布转化率、一次路由成功率、阻塞问题平均数（目标 ≤1）、过度建设率（问句被建成 app 的比例） | |
| 留存 | watch 7/30 日存活、Playbook 回访率、Tune 使用率（有人调=有人在乎） | |
| 生态 | share-safe 采用率、Remix 数、remix 后完成 preflight 比例 | Remix 跳过 gate 的比例是模板生态的质量红线 |

## 5. 路线图

- **v1（本 Skill）**：Binance 现货、σ 标定 alert、私有 Playbook、share-safe、
  manual-holdings 降级。
- **v1.5**：合约/杠杆仓位（需要独立的保证金与清算距离 alert 类型，不是把
  杠杆仓塞进现货 NAV——这是 v1 明确排除它的原因）；成本价导入向导。
- **v2**：多账户/跨所聚合；alert 规则的用户自定义层（在 preset 之上开白盒）；
  官方 Blueprint 化——把高留存 watch 的参数组合沉淀为可发现模板。
- **持续**：alert 质量反馈闭环（每条 alert 可标"有用/噪音"，反哺阈值与
  materiality 分类器）。

## 6. 验证方式（本仓库的 evals）

没有平台账号无法真实部署，所以用**行为评测**验证 Skill 是否改变 Agent 行为：
让 Agent 在模拟 Alva 环境下处理 5 类典型请求（标准构建、含糊问句、噪音需求、
未连接账户、公开分享），对照有/无 Skill 的输出，断言检查的不是文风而是
**决策**：是否声明 alert output、是否走有界历史、是否有 novelty gate、
是否过度建设、是否默认 private、是否拒绝为分享暴露绝对值。
详见 `evals/evals.json` 与评测报告。

## 7. 实地裁决记录（v2 术语校准）

基于实地调研 evidence（浏览器行为观察 + 官方 skill 文档），v2 做了以下裁决：

- **"Feed" 是内部词**：产品 UI 全程未出现 "Feed"/"Producer"，用户可见词是
  automation / playbook / alert / Agent / script（官方文档明文规定 +
  UI 行为双重确证）。Skill 新增 "Speak the user's dialect" 一节，
  区分内部词汇与用户话术。
- **follow ≠ alert 订阅**（行为确证）：公开 Playbook 上的 "Subscribe" 按钮
  是 follow，点击后 Alert 订阅列表无新增；follower 要收 alert 必须另行
  建立 alert binding。这直接支撑了 v2 的"送达四条件"拆分（bot#6 与实地
  一致）。
- **运行流与通知流是两条流**（行为确证）：用量页逐 run 计费记录 ≠ 通知；
  每分钟失败的自动化只在对话里留一条系统消息。"安静 ≠ 停摆"（bot#7）
  与实地一致。
- **无顶层 await**（文档 + agent 行为旁证）：线上 agent 自己写的
  `alva run --code` 脚本即为 `(async()=>{...})();` 形态。

阶段 2 真机校准（对照 CLI `--help` 全树 + 官方 skill references）追加的裁决，
全表见 `calibration.md`：

- **digest 是平台契约不只是产品判断**：declared alert output 每次运行每个
  source 最多返回 1 条记录（root `body` 必填）→ v1 的 `alerts` 组拆成
  审计日志输出 + `alertOutput` digest 输出两件事。
- **免费档不能发布私有 Playbook**（private/paid 是付费权益，网关直接
  PERMISSION_DENIED）→ "private by default" 改写为档位感知的诚实阶梯：
  draft → share-safe 公开 → 付费档 private。宁可停在 draft，不为发布把
  真实余额转公开。
- **官方 fail-fast vs 本 Skill 的降级阶梯**存在真实张力：官方要求不许
  catch-and-continue 造假数据；本 Skill 保留"逐资产 carried price"作为
  **显式声明的业务状态**（写 `pricing:"carried"/stale:true`、压制该资产
  alert），其余一律 throw 让 run 显式失败。这是有意的、留痕的偏离，
  理由：对钱的误报比漏一轮刷新的代价高一个量级。
- **bot 两处二手信息被文档证伪**：alpi 线上正常用法是**完全省略**
  `getApiKey`（BYOK 才提供且必须走 secret-manager）；"content blocks"
  描述的是 `agent.ask(string)` 的**返回** message 形态，不是入参。

## 8. 真机踩坑记录（阶段 3 实测,均有证据在 demo-evidence/）

1. **`playbooks set-visibility private` 稳定返回 503** "playbook dependency
   unavailable"（pro 账号、feed 已 private、跨 1 小时重试 5 次）。后果：
   私有发布这一档在实测期间不可达,demo 的私有版停在 public 状态——但其
   backing feed 是 private,匿名访客只能看到页面的诚实空态（"feed read
   failed",见证据 19),真实数字不可见。这也侧面验证了"数据层隔离优于
   CSS 隐藏"的设计:页面拿不到的数据就是泄露不了。
2. **一个 cronjob 注册第二个 feed 报裸 500**(无错误语义)。绕行:share-safe
   feed 用一个**立即暂停的 no-op 锚点 cronjob** 作注册载体,数据仍由主
   producer 同一 run 写入——"同一时钟"的产品约束守住了,代价是平台上多一个
   暂停的空 cronjob。若平台原生支持"一 producer 多 feed",share-safe 的
   实现会干净得多——这是给平台的产品反馈。
3. **平台截图服务无法进入私有 Playbook**(published_url 无 viewer token;
   canonical URL 403,与调研期观察到的 `PLAYBOOK_PAGE_NAVIGATION_DENIED`
   一致)。后果:私有页的"截图门"只能由 owner 浏览器目检 + 同代码路径的
   share-safe 公开页截图替代。Skill 的 definition-of-done 因此在实践中
   对私有页有一个已知的验证降级。
4. **`alva run` 的 logs 字段不回传 console.error**(两次手跑 logs 均为空,
   但数据落盘正常)。调试时应以读回 feed 数据为准,不依赖日志。
5. **计费口径**:短脚本 run 每次约 1 credit,整个端到端(含所有验证、两次
   投递 trigger、截图)约 30 credits——远低于预算,hourly automation 长期
   运行的成本才是主要项(约 1 credit/run × 24/天)。

## 9. v1→v2 变更清单（来源标注,与 git 历史一一对应）

| # | 变更 | 来源 |
|---|---|---|
| 1 | 送达四条件拆分 + written≠delivered + follow≠订阅 | bot#6,实地确证 |
| 2 | 安静≠停摆:精确为"不向声明输出追加" | bot#7,官方文档原文确证 |
| 3 | Agent Schedule 路由行(脚本重复跑 vs Agent 重新想) | bot#2/#11,CLI 确证 |
| 4 | Feed Scope Isolation | bot#16,官方文档确证 |
| 5 | async IIFE + alpi 结构校准 | bot#8-10;其中两点被文档证伪后二次修正(见 §7) |
| 6 | Tune:源码改动不重发布,publish 是 create-only | bot#5,官方文档确证 |
| 7 | 写入幂等(平台按 date 去重作安全网) | bot#12 + SDK 文档 |
| 8 | share-safe 三规则(同 run/脱敏镜像/先预览) | iter1 评测发现 |
| 9 | 用户话术 vs 内部词汇("Speak the user's dialect") | 实地调研 |
| 10 | eval-4 收紧 + eval-5/6 新增 | iter1;iter2 中 eval-4 收紧被证明有判别力 |
| 11 | alerts 组拆分(审计日志 + alertOutput digest,平台 1 条/source/run) | 阶段 2 校准 |
| 12 | 档位感知可见性(free: draft→share-safe;paid: private) | 阶段 2 校准 + 阶段 3 实测 |
| 13 | fail-fast 与降级阶梯的调和(窄化 carried 为显式业务状态) | 阶段 2 校准,有意偏离,§8.1 佐证 |
| 14 | 验证纪律:alva run(不投递)测,deploy trigger(真投递)只用于受控送达 | 阶段 2 校准 + 阶段 3 实测 |

## 10. 已知盲区

- 平台 API 具体签名以线上 SDK 文档为准，Skill 已把"fresh discovery、不凭
  记忆调 API"写为强制步骤，但未经真实环境冒烟。
- alert 阈值默认值（K=3、band 间距、cooldown 24h）是产品判断的起点，
  应上线后用 alert 质量指标校准，而非当作定论。
- 新闻源覆盖与 materiality 分类准确率未验证，v1 将 news alert 限制在
  high materiality 正是为此留的安全边际。
