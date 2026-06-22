# ViMax Web Triage

## 用途
SessionStart 时自动分类故障，将发现写入 STATUS.md Next 区域。

## 工作流

### 1. 收集数据 (3 来源)
```bash
# a) 最近失败的测试
cd backend && python -m pytest tests/ --tb=short -q 2>&1 | tail -20

# b) 最近 git log
git log --oneline -10

# c) learnings inbox 中的 pending 项
ls .claude/learnings/inbox/*.json 2>/dev/null | tail -10
```

### 2. 分类

将发现分组：
- **P0 — 阻塞**：测试失败、API 不可用、构建错误
- **P1 — 高优**：功能不完整、已知回归
- **P2 — 低优**：警告、技术债、性能建议

### 3. 写入 STATUS.md

在 STATUS.md 的 `## 📋 Next` 区域添加：

```markdown
- [P0] <故障简述> — 发现时间: <timestamp>
- [P1] <故障简述>
- [P2] <故障简述>
```

### 4. 更新 heartbeat

```bash
sed -i "s/> 最后更新:.*/> 最后更新: $(date -Iminutes)/" STATUS.md
```

## 约束
- **不修复代码**（Maker ≠ Checker），只记录和分类
- 最多 5 条新增项（避免 STATUS.md 过期）
- 不触碰 `🚫 Never` 区域
- 如果 inbox 有 pending 项，提醒运行 `/learning` skill
- 中文输出

## 触发
- 手动: `/triage`
- 自动: SessionStart hook 可引用本 skill
