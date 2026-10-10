# PvZ 学习与存档 API 集成

儿童应用独立运行在 `http://localhost:8080/`，默认使用同源 `/api` 的真实学习平台。
根页面是免密码的儿童/存档选择器；选择成功后仅把服务端返回的 `{token, account, save}`
写入 `sessionStorage["pvz.play.selection"]`，并在同一标签页进入
`/game/?saveId=<正整数>`。家长管理应用独立运行在 `http://localhost:8081/`；游戏忽略家长
cookie，家长退出也不影响已选中的儿童标签页。仅显式 `?demo=1` 使用内存本地 provider，
不调用任何 API；网络、认证或配置错误绝不会静默回退演示题。

完整服务端契约以 `../learning-platform/API.md` 为准。本目录只实现游戏侧适配。

## 启动门与存档隔离

`bootstrap.js` 在导入 Cocos 引擎前依次确认：

1. URL 中存在合法 `saveId`（演示模式除外）；
2. sessionStorage selection 含合法 token/account/save，且 URL `saveId` 与 selection.save.id 一致；
3. 携带 `Authorization: Bearer <token>` 的 `GET /api/play/context` 返回同一 account/save；
4. 携带同一 bearer 的 `GET /api/saves/{saveId}/game-state` 返回合法的两键状态。

缺失、无效、过期或身份不匹配的 selection 会返回 `/` 存档选择器，不跳转登录页；身份
不匹配时只删除 `pvz.play.selection`。网络失败保留 selection 并显示重试，不加载引擎。
页面绑定的 token/account/save 在生命周期内不可改变；新选择只影响当前标签页。运行期间
任一 API 返回 401 会统一触发 `play:authorization-required`，停止关卡入口和原生状态同步，
仅当 sessionStorage 仍是失败请求捕获的旧 token 时才清除 selection，然后返回选择器。

原生 Cocos 仍访问 `window.localStorage`，但仅当 `this === window.localStorage` 且 key
为 `PvZ2_PlayerProperties` 或 `PvZ2_Settings` 时映射到
`pvzge:native:<accountId>:<saveId>:<key>`。其他 key、其他 Storage 实例和旧的未加前缀
值保持不变；不会自动迁移或删除旧值。玩家数组必须是 JSON array，设置必须是 JSON
object。同步 PUT 总是携带两键和基础 revision；本地未同步值先进入持久 outbox。若 PUT
已在服务端提交但响应丢失，客户端在传输失败、CAS 409 或 reload 时读取最新状态：只有服务端
两键与该次待提交快照逐值完全相同，才认定已提交、采用最新 revision 并清理或 rebase outbox；
期间产生的更新使用新 revision 继续提交，不会被旧响应删除。任一值不同都是真实冲突，停止
写入并要求重新加载，绝不盲目覆盖服务器。

## 四方法 provider

`createRemoteLearningProvider({saveId})` 实现：

- `POST /api/learning/create-session`（仅此请求加入 `saveId`）
- `POST /api/learning/get-next-task`
- `POST /api/learning/submit-answer`
- `POST /api/learning/end-session`

全部同源 `/api/` 请求经 `api-client.js` 使用页面启动时配置的 bearer、
`credentials: "omit"`，并转发 `AbortSignal`。token 不写 cookie、localStorage、outbox、
receipt 或日志。session 响应保留
`questionCount/completedCount/correctCount/saveId/configurationVersion`；控制器从服务端进度
恢复并以动态题数运行，不能用固定十题推断完成。未完成时收到 `no_task` 是可见错误。

submission 在 POST 前按 save 写入 outbox，不保存 cookie 或认证信息；reload 后先用完全
相同的 `attemptId` 和 payload 重放，成功且响应身份逐字段匹配后才删除。deadline 时提交的
`answered` 可由服务端正规化为 `recorded/timed_out`，这不是错误或答错。未知响应、错误
session/save、畸形 JSON 和身份不匹配均保持门关闭并显示重试/取消。

`submit-answer` 的已接受响应可选返回严格对象
`feedback: {correctOptionId, correctAnswer, explanation}`；三个字段均为非空 plaintext，
`explanation` 最长 4000 字符。该对象只在提交后出现，发题 DTO 仍不得包含答案。旧服务端或
旧 outbox 重放响应可省略 `feedback`；客户端此时只显示 `这道题暂无详细题解`，不会猜测或
拼造正确答案。选择答案后原题和选项保留在同一 dialog，倒计时停止，服务端确认前不标记
正误；确认后题解阅读不限时，用户必须点击 `下一题` 或末题 `完成本轮` 才继续。

`end-session` 是有界且必须等待的操作。最终 `sessionId`、`questionCount` 和 grant 全部校验
后，控制器才返回奖励。

只有 `final.gameUnlocked` 为真（答对数 ≥ 90% 题数，服务端判定）的一轮才会开始游戏，也只有
这一轮发放阳光（未达标轮次 `sunCount` 为 0）。未达标时显示“再来一轮”卡片：可开始新的一轮
（不限次数），或“返回主菜单”。旧服务端未返回 `gameUnlocked` 时，客户端按同一 90% 规则自行
计算。用户明确取消（加载/出错时或“再来一轮”卡片上的“返回主菜单”）会尝试结束部分 session，
不进入游戏，并调用原生 `KeyListener.GoToMain()` 回到主菜单，不再以零奖励进入游戏。

## 游戏运行与奖励

每次新原生关卡 controller 使用独立 `runId`，向 `POST /api/game-runs` 报告 `started`，并
观察 `gameWon/gameLost` 或退出状态后报告一次 `won/lost/abandoned`。事件在请求前持久化，
重试复用同一 `requestId`；`pagehide` 使用 beacon 并保留 fetch keepalive/outbox 兜底。

奖励数量只取 end-session 的 `final.reward.sunCount`（整数 0–500），不再由答对数乘常量。
实际生成原生阳光后，先写每 save/run 的本地 receipt（含原生进度快照），再调用
`POST /api/rewards/{grantId}/ack`。receipt 防止同页面/同浏览器重复生成；服务端 ack 提供
跨请求幂等。浏览器 localStorage 与服务端数据库不是原子事务，因此不宣称跨二者严格原子。

服务端任务的 `startedAt` 为第一次发题的 UTC 时间，客户端 view 只显示当前页面内从本次
渲染开始的倒计时。刷新后服务端仍按提交 `elapsedMs` 判断客户端 deadline，并把服务端观察
耗时仅用于历史记录；客户端不伪造已完成或错误答案。
