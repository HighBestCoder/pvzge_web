# PvZ 学习 Provider API（schemaVersion 1）

本模块把游戏编排与学习服务隔离。游戏控制器只依赖四个异步方法；`bootstrap.js` 是唯一选择题源和配置演示学习者的组合入口，当前注入 `createLocalLearningProvider`。将来可用相同 DTO 实现远程 provider，不需要修改题目渲染和游戏奖励逻辑。

```js
const provider = createLocalLearningProvider({
  learnerRef: "demo-learner",
  random: Math.random,
  id: () => crypto.randomUUID(),
});

await provider.createSession(request, { signal });
await provider.getNextTask(request, { signal });
await provider.submitAnswer(request, { signal });
await provider.endSession(request, { signal });
```

构造参数均可省略。`learnerRef` 是本地演示配置，不允许客户端在请求中提交 `learnerId`；未来后端必须从认证身份推导学习者。所有方法立即检查已经 aborted 的 `AbortSignal` 并抛出 `AbortError`。这只表示客户端操作中止，不是 `cancelled` 学习结果；如需记录取消，仍须用相同身份字段调用 `submitAnswer`。

## DTO 与校验边界

所有请求和响应都有 `schemaVersion: 1`。`docs/learning/provider.js` 导出：

- `LearningProviderError(code, message)`：协议、引用和幂等冲突的类型化错误。
- `parseSession(value)`、`parseTask(value)`、`parseTaskResponse(value)`、`parseSubmissionResult(value)`：供远程 adapter 或通用父级 view 校验不可信公开 payload；函数重建白名单对象并深复制数组，不透传额外字段。

未知 `schemaVersion`、`kind` 或 `format` 必须拒绝，不能静默降级。`questionVersion` 是题目内容版本，不是协议版本，允许任意正安全整数，并须在提交和结果中原样关联。v1 只支持 `single_choice`、`plain_text` 和**恰好 4 个**不同 `optionId`。通用协议未来可以扩展到 2–6 个选项，但当前渲染器没有能力协商；改变数量前必须先增加 capability/schema version 协商。选项正文是字符串，可为文字，不应假设它是数字。

## 1. createSession

请求（仅允许这些字段）：

```json
{
  "schemaVersion": 1,
  "requestId": "create-7f4a",
  "gameSessionId": "game-a19c",
  "gameContext": {
    "gameId": "pvzge",
    "levelIds": ["1-1", "1-2"],
    "locale": "zh-CN"
  }
}
```

响应：

```json
{
  "schemaVersion": 1,
  "status": "active",
  "sessionId": "learning-3b62",
  "learnerRef": "demo-learner",
  "plan": {
    "planId": "local-addition-v1",
    "title": "百以内加法",
    "subjectId": "math",
    "skillIds": ["addition-within-100"]
  }
}
```

## 2. getNextTask

请求：

```json
{"schemaVersion":1,"requestId":"next-83ca","sessionId":"learning-3b62"}
```

有题响应：

```json
{
  "schemaVersion": 1,
  "status": "task",
  "task": {
    "taskId": "task-d011",
    "questionId": "question-68be",
    "questionVersion": 1,
    "kind": "single_choice",
    "content": {"format":"plain_text","prompt":"34 + 27 = ?"},
    "options": [
      {"optionId":"opt-a813","content":{"format":"plain_text","text":"60"}},
      {"optionId":"opt-c204","content":{"format":"plain_text","text":"61"}},
      {"optionId":"opt-f932","content":{"format":"plain_text","text":"62"}},
      {"optionId":"opt-b417","content":{"format":"plain_text","text":"59"}}
    ],
    "metadata": {"subjectId":"math","skillIds":["addition-within-100"]},
    "timeLimitMs": 20000
  }
}
```

也可返回 `{"schemaVersion":1,"status":"no_task"}` 或 `{"schemaVersion":1,"status":"session_ended"}`。未终结的已发任务会重复返回，不会并行生成新题。每份不可变题目内容有唯一 `questionId`，与一次派发的 `taskId` 分离；技能分类继续放在 `metadata.skillIds`。公开 task 绝不含 `answer` 或 `correctOptionId`；option ID 是与显示文本无关的不透明标识。provider 只返回学习元数据，不返回阳光类型、数量或任何游戏奖励。

## 3. submitAnswer

共同身份字段必须与已发任务一致：

```json
{
  "schemaVersion": 1,
  "sessionId": "learning-3b62",
  "taskId": "task-d011",
  "questionId": "question-68be",
  "questionVersion": 1,
  "attemptId": "attempt-5aa1",
  "response": {"type":"answered","optionId":"opt-c204","elapsedMs":4380}
}
```

`response` 的完整联合类型：

- `{"type":"answered","optionId":"...","elapsedMs":0}`
- `{"type":"timed_out","elapsedMs":20000}`
- `{"type":"skipped","elapsedMs":250}`
- `{"type":"cancelled","reason":"scene_changed|hidden|stopped|superseded","elapsedMs":250}`

作答响应：

```json
{
  "schemaVersion":1,"status":"graded","sessionId":"learning-3b62",
  "taskId":"task-d011","questionId":"question-68be","questionVersion":1,
  "attemptId":"attempt-5aa1","evidenceId":"evidence-91f0","correctness":"correct"
}
```

非作答响应使用相同身份字段，另为 `"status":"recorded"`，并含
`"outcome":"timed_out|skipped|cancelled"`。无效 session/task/option、身份或版本不匹配、attempt 冲突均抛出 `LearningProviderError`，不能当作 `incorrect`。题目一旦产生终结结果，换新 `attemptId` 再提交会失败。

## 4. endSession

```json
{"schemaVersion":1,"requestId":"end-f81a","sessionId":"learning-3b62","reason":"game_ended"}
```

`reason` 为 `game_ended|replaced|stopped|abandoned`，响应为：

```json
{"schemaVersion":1,"status":"ended","sessionId":"learning-3b62"}
```

结束后不再发新题，但结束前已经发出的题仍可提交，用于解决结束与提交竞态。

## 幂等、关联与本地生命周期

- `schemaVersion` 是通信结构版本；`questionVersion` 是具体题目的内容版本，二者互不替代。
- 当前每个游戏关卡身份建立独立学习会话。远端可以依据认证学习者、`gameContext` 和历史进度返回学习计划及下一道任务；本地的固定演示计划不代表已经实现个性化规划。
- `quiz-view.js` 仅返回 `response` 意图，不包含正确性。控制器补齐会话/题目/任务/作答身份，交由 provider 判题，再由游戏自己的奖励规则决定是否发五个阳光。
- 取题期间继续游戏；选择、超时或跳过后立即关闭题目并恢复游戏，再等待判题或记录。网络版奖励可能晚于点击到达，不能承诺网络延迟为零。
- 编排器对每次调用设置 10 秒上限和取消信号，拒绝不匹配的结果。当前没有自动重试与跨刷新提交队列：超时代表记录结果未知，未来远程适配层须持久化原提交并使用相同 `attemptId` 查询或重试；不得伪造答错或奖励成功。

- `createSession`、`getNextTask`、`endSession` 以 `requestId` 幂等；完全相同的重试返回相同结果，同 ID 不同 payload 抛 `REQUEST_CONFLICT`。每次逻辑调用必须生成新 ID，网络重试必须复用原 ID。
- `submitAnswer` 以 session 内的 `attemptId` 幂等；完全相同的重试返回相同 `evidenceId`，冲突 payload 抛 `ATTEMPT_CONFLICT`。
- 父级必须逐字段核对响应中的 session/task/question/version/attempt 身份，再更新当前 UI，避免迟到响应污染新场景。
- 本地 provider 的 session、答案和幂等记录只保存在私有内存中，页面 reload 后清空；当前演示不设任意容量上限。生产远程实现应按服务端生命周期持久化并回收。
- 本地 mock 隐藏答案是接口边界保证，不是浏览器防作弊安全边界。真正的判分和认证必须放在远程服务端。
- 本契约不改变现有“符合条件的活跃游戏过程中”计时和出题策略；父级仅在现有触发点调用 provider，不把出题移到关卡前。
