# 更新日志 Changelog

本文件记录本项目的所有重要变更。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.2.0] - 2026-02-04

### 变更
- 产品正式命名为 **天津美术学院AIGC Tools**，版本号 0.2.0
- 打包安装包/便携版名称：`天津美术学院AIGC Tools Setup 0.2.0.exe`、`天津美术学院AIGC Tools 0.2.0.exe`
- 界面与关于信息中的品牌统一为天津美术学院AIGC Tools

### 说明
- 本版本基于原 Penguin Magic v1.6.0 魔改，沿用其功能更新历史；以下 1.6.0 为上游版本记录。

## [1.6.0] - 2026-01-31（上游基线）

### 新增
- 画布平移模式：右上角「平移」按钮一键切换，左键拖拽即可移动画布
- ComfyUI 集成与配置面板、ErrorBoundary 等
- 完善开源项目规范：CHANGELOG.md、CONTRIBUTING.md，统一使用本文件作为唯一更新日志

### 改进
- 移除 LiteGraph.js 迁移实验代码，保持代码库整洁
- 画布拖拽事件与渲染稳定性优化
- ComfyUI 相关组件与 API 调整

### 移除
- 移除 README 顶部图片引用（不再随仓库备份）
- 移除旧版按版本号命名的 CHANGELOG 文件（CHANGELOG_1.x.x.txt），统一使用本文件 CHANGELOG.md

---

## 版本号说明

- **主版本号 (MAJOR)**：不兼容的 API 修改或重大架构变更
- **次版本号 (MINOR)**：向下兼容的功能性新增
- **修订号 (PATCH)**：向下兼容的问题修正

## 变更类型

- **新增**：新功能
- **改进**：对现有功能的改进
- **弃用**：即将移除的功能
- **移除**：已移除的功能
- **问题修复**：Bug 修复
- **安全**：安全相关的修复
