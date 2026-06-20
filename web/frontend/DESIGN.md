# Design System — ViMax

## Product Context
- **What this is:** AI 短剧创作平台 — 输入创意，AI 自动生成故事/角色/分镜/视频
- **Who it's for:** 景区运营人员（非技术人员），独立完成从想法到成片
- **Space/industry:** AI 创作工具 / 视频生成
- **Project type:** Web App (SPA)

## Aesthetic Direction
- **Direction:** Creative Studio — 灵感来自 Canva 的亲和力 + 视频编辑工具的精度
- **Decoration level:** Intentional — 微妙的渐变、柔和的阴影、玻璃态面板
- **Mood:** 有创造力、受启发、不畏惧技术。打开工具就让人想创作

## Typography
- **Display/Hero:** Cabinet Grotesk (700) — 品牌标题，有个性但不花哨
- **Body:** DM Sans (400/500/700) — geometric sans，清晰现代
- **UI/Labels:** DM Sans (500)
- **Mono:** JetBrains Mono — session ID、日志、代码
- **Loading:** Google Fonts CDN
- **Scale (Tailwind):**
  - xs: 0.75rem / 1rem
  - sm: 0.875rem / 1.25rem
  - base: 1rem / 1.5rem
  - lg: 1.125rem / 1.75rem
  - xl: 1.25rem / 1.75rem
  - 2xl: 1.5rem / 2rem
  - 3xl: 1.875rem / 2.25rem

## Color (Light Mode)

| Token | Hex | Usage |
|-------|-----|-------|
| `--background` | `#FAFAF9` | 页面背景 (warm stone) |
| `--foreground` | `#1A1A1A` | 主文字 |
| `--card` | `#FFFFFF` | 卡片背景 |
| `--card-foreground` | `#1A1A1A` | 卡片文字 |
| `--primary` | `#FF5A5F` | 主按钮、进度条、强调 (warm coral) |
| `--primary-foreground` | `#FFFFFF` | 主按钮文字 |
| `--secondary` | `#3B82F6` | 链接、信息状态 |
| `--secondary-foreground` | `#FFFFFF` | |
| `--muted` | `#F4F4F5` | 弱化背景 |
| `--muted-foreground` | `#71717A` | 弱化文字 |
| `--accent` | `#FEF3C7` | 高亮/灵感元素 (warm amber) |
| `--accent-foreground` | `#92400E` | |
| `--destructive` | `#EF4444` | 危险操作 |
| `--destructive-foreground` | `#FFFFFF` | |
| `--border` | `#E4E4E7` | 边框 |
| `--input` | `#E4E4E7` | 输入框边框 |
| `--ring` | `#FF5A5F` | 聚焦环 |
| `--sidebar` | `#FAFAF9` | 侧边栏背景 |
| `--sidebar-foreground` | `#3F3F46` | 侧边栏文字 |
| `--sidebar-accent` | `#F4F4F5` | 侧边栏选中 |
| `--sidebar-accent-foreground` | `#18181B` | |

### Semantic
| Token | Hex | Usage |
|-------|-----|-------|
| `--success` | `#22C55E` | 成功状态 |
| `--warning` | `#F59E0B` | 警告状态 |
| `--error` | `#EF4444` | 错误状态 |
| `--info` | `#3B82F6` | 信息状态 |

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable — 非技术用户不习惯信息密集型界面
- **Scale:** xs(4px) sm(8px) md(16px) lg(24px) xl(32px) 2xl(48px) 3xl(64px)

## Layout
- **Approach:** Hybrid — 4 列结构（导航+管线+主区+对话）
- **Grid:** 12 columns for dashboard, fluid for wizard
- **Max content width:** 1200px (dashboard), 100% (wizard)
- **Border radius:** sm:6px, md:10px, lg:16px, full:9999px

## Motion
- **Approach:** Intentional — 有意义的过渡，不滥用
- **Easing:** enter: ease-out, exit: ease-in, move: ease-in-out
- **Duration:** micro(100ms) short(200ms) medium(300ms) long(500ms)

## Anti-Patterns (never use)
- ❌ Purple/violet gradients as default accent
- ❌ Centered everything with uniform spacing
- ❌ Generic stock-photo hero sections
- ❌ Uniform bubbly border-radius on all elements
- ❌ Inter/Roboto/Arial as primary font
- ❌ 3-column icon grids in colored circles

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-20 | Initial design system created | Coral primary + DM Sans + Cabinet Grotesk, warm & approachable creative tool aesthetic |
