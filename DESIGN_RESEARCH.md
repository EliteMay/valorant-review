# VReview v0.7.0 Visual Research

## Target Type

- Primary Task: Gameplayを見ながら自動検出Sceneを確認・修正する
- Content: Video / Timeline / Scene Inspector / Detector controls
- Audience: VALORANT Player / 個人Desktop利用
- Usage Frequency: repeated
- Density: medium-high / high
- Tone: technical / competitive / calm
- Primary Device: desktop
- Primary Visual Material: gameplay video

## Reference Research

v0.7.0の意味のあるVisual変更前に、同じPrimary Taskへ近い現行Toolを確認した。

### Insights.gg / Insights Capture

- Game VOD / event review
- Gameplayが最大Visual
- Kill / Death等のEventをTimelineへ近接表示
- Review / CommentはSide Pane

Transfer: gameplay + event timelineの主従関係。
Do not copy: 色、具体的な幅、個別Game UI。

### Frame.io

- Video review / timestamp feedback
- Main media + timeline + timestamped feedback pane
- Feedbackは巨大Cardの縦積みではなくList / Inspectorとして高密度

Transfer: timestampとside feedbackの距離感。
Do not copy: Brand / collaboration機能 /具体Component。

### Hudl

- Sports video analysis
- Main videoと高密度Analysis / Data Pane
- Tool / MetadataはCompactに維持

Transfer: analysis toolとしての情報密度とsecondary controlsの抑制。
Do not copy: Sports固有data / navigation。

### Medal

- Gameplay clip editor
- Large preview + timeline + side tools
- Dark workstation、minimal chrome

Transfer: gameplay editorとしてのPreview / Timeline / Tool Pane構成。
Do not copy: Editor固有toolやbrand表現。

## Current UI Review

### KEEP

- 中央動画固定 + 右Scene PaneだけScroll
- Dark theme
- VALORANT red accent
- primary / weak分類
- Timelineを動画の近くに置く

### FIX

- Panel / Cardの過剰使用
- 巨大Heading / StatによるGeneric Dashboard感
- 右Paneの独立Card縦積み
- Red Primary Buttonの過剰強調
- Generic Admin Sidebar
- Scene 1件の過大な縦余白
- Development情報がPrimary Workflowと同強度

### REMOVE

- Review画面の大きな開発中AI Package Card
- 独立Development Support Card
- Sidebarの開発中機能一覧
- Dashboardの巨大Stat Card 4枚構成

## Chosen Direction

**Review Workbench**

```text
Compact Navigation
│
├─ Gameplay + Event Timeline + Clip Controls
└─ Continuous Scene Inspector
```

SignatureはGameplay / Timeline / Inspectorを1つの連続した作業台として見せること。

Visual Priority:

1. Gameplay
2. Timeline / Selected Scene
3. Scene Inspector
4. Detector Controls
5. Feedback Export
6. Development information

## Verification Rule

この文書はDirection決定のEvidenceであり、完成Visualの成功証明ではない。

- Static CI成功 ≠ Visual Validated
- Browser / Screenshot未確認 ≠ Visual完成
- Userが実画面へ明確な肯定Feedbackを出すまでValidated Direction / Project Successへ昇格しない
