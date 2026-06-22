# ViMax Web Learning

## 用途
SessionStart 时扫描 `.claude/learnings/inbox/` 中的 pending 失败项，分析提炼后写入 LEARNINGS.md。

## 工作流

### 1. 扫描 inbox

```bash
ls .claude/learnings/inbox/*.json 2>/dev/null
```

只处理 `"status": "pending"` 的项。

### 2. 逐项分析

对每个 pending 项：
- **症状**：从 `reason` 字段提取
- **根因**：从 `transcript_tail` + 上下文推断
- **分类**：
  - 🔴 Patterns：可复现的反模式（同类型出现过 ≥2 次）
  - 🟡 Gotchas：技术栈特有的陷阱（一次性，但他人可能踩）
  - 🟢 Fixes：已验证的修复配方（问题 → 步骤 → 验证）

### 3. 写入 LEARNINGS.md

- Patterns 写入 `## 🔴 Patterns` 表格
- Gotchas 写入 `## 🟡 Gotchas` 表格
- Fixes 写入 `## 🟢 Fixes` 表格

格式：
```markdown
| P{n} | {症状} | {根因} | {正确做法} | {日期} |
```

### 4. 标记已处理

将 inbox 中已处理的项 `"status"` 改为 `"processed"`，并添加 `"processed_at"` 时间戳。

### 5. 更新统计

更新 LEARNINGS.md 底部的 `## 📊 统计` 表格。

## 约束
- 不记录琐碎项（拼写错误、格式调整）
- 每条 ≤ 150 字符（症状描述）
- 查重：与已有条目比对，重复的跳过（标记为 `duplicate`）
- 过时条目用 `~~删除线~~` 标记，不物理删除
- 最多处理 10 个 pending 项/次
- 中文输出

## 触发
- 手动: `/learning`
- 自动: SessionStart hook 可引用本 skill
