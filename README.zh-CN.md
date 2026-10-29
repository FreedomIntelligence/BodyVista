[English](README.md) | **中文**

<p align="center">
  <img src="src/brand/bodyvista.png" alt="BodyVista logo" width="100" height="100">
</p>
<h1 align="center">BodyVista</h1>

<p align="center">
  <a href="https://freedomintelligence.github.io/BodyVista/">🌐 在线访问</a>
</p>

<p align="center">
  <img src="https://visitor-badge.laobi.icu/badge?page_id=FreedomIntelligence.BodyVista&amp;left_text=visitors" alt="visitor badge">
</p>


**从人体结构到生命活动，让解剖知识可以观察、操作和探索。**

`BodyVista` 是面向解剖与生理教学、自主学习的三维交互平台。它将 **2,900 个解剖结构、12 个人体系统、140 项动态演示入口与 6 个微观主题**整合到浏览器中，帮助学习者理解人体的空间关系、结构层次与生理功能。

支持 **中文、英文、日文**，适配电脑与移动端。核心交互在浏览器本地运行，无需自建后端或数据库，可部署到 GitHub Pages。

## ✨ 功能

| 模块 | 功能与学习价值 |
| --- | --- |
| 人体解剖 | 浏览 2,900 个结构，按系统与 7 大身体区域筛选；通过选择、逐层隐藏、多选、半透明和结构定位，观察毗邻关系与解剖层次。 |
| 生命律动 | 提供 133 项系统动态、5 项全身联动和 2 项口腔与牙齿动态入口，连接静态解剖与功能理解；支持播放、进度及速度调节。 |
| 微观探索 | 覆盖肺泡气体交换、肾单位、肌节收缩、神经突触、肠绒毛和血管壁 6 个主题，衔接宏观器官与微观机制。 |
| 解剖挑战 | 通过结构识别、三维解剖寻找和微观知识问答进行练习；每轮 5 题，提供答案反馈、成绩与重新挑战入口。 |


本项目用于教学与学习。动态、微观及部分口腔结构包含示意性表达，不作为临床诊断或治疗决策工具。

## 🛠️ 技术栈

| 层级 | 技术 |
| --- | --- |
| 主站界面 | JavaScript ES Modules、HTML、CSS |
| 三维渲染 | Three.js、WebGL、GLTFLoader |
| 口腔模块 | TypeScript、Three.js、three-mesh-bvh；集成的上游模块使用 Zustand，并包含 React 依赖 |
| 数据与多语言 | 本地 JSON 数据、三语词典与翻译覆盖检查 |
| 构建 | Vite 7、npm |
| 测试 | Node.js 内置测试运行器 |
| 部署 | GitHub Actions、GitHub Pages |

## 🚀 如何运行

### 本地开发

准备 **Node.js 22.12 或更高版本**及 npm：

```bash
git clone https://github.com/FreedomIntelligence/BodyVista.git
cd BodyVista
npm ci
npm run dev
```

在浏览器中打开终端输出的本地地址。源码入口需要通过 Vite 运行，请勿直接双击 `index.html`。

### 测试与构建

```bash
npm test
npm run build
npm run preview
```

`npm run build` 会先检查翻译及口腔模块内容覆盖，再将网站输出到 `dist/`。`npm run preview` 用于本地预览构建结果。

模型与缩略图随仓库提供，克隆和首次加载需要一定时间。请保留 `assets/`、`thumbs/` 和 `dental/models/`。

### GitHub Pages 部署

仓库使用 [GitHub Actions](.github/workflows/pages.yml) 自动部署。在仓库的 **Settings → Pages → Build and deployment** 中，将 **Source** 设置为 **GitHub Actions**。

每次推送到 `main`，工作流都会使用 Node.js 22 安装锁定依赖、运行测试和内容检查、构建网站及模型资源，然后发布 `dist/`。也可以在 **Actions → Deploy BodyVista to GitHub Pages → Run workflow** 手动部署。

## 🌱 期望

我们希望 BodyVista 能降低人体科学知识的学习门槛，为低资源地区提供直观、易获取的科普与教学资源。同时，推动相关研究在 **VR、AR 等沉浸式场景**中落地，让人体结构与生命活动成为可观察、可交互、可探索的学习体验。

## 🙏 致谢

感谢以下项目、作者与机构提供的资源和基础工作：

- **Z-Anatomy、Lluís Vinent 及贡献者**：人体解剖模型与相关数据。结构来源记录见 [`catalog.json`](catalog.json) 中的 `source_attribution`。
- **BodyParts3D / The Database Center for Life Science（DBCLS）**：人体与口腔模型的基础资源。
- **Dental Scope、Yoseph 及贡献者**：口腔引擎、结构注册表、教学内容和模型。集成说明见 [`dental/README.md`](dental/README.md)，原始署名与修改记录见 [CREDITS](dental/vendor/CREDITS.md) 和 [模型来源文档](dental/vendor/docs/assets.md)。
- **OpenStax《Anatomy and Physiology 2e》**：结构知识与生理主题的教学参考；具体章节链接保留在相应内容数据中。
- **Three.js、Vite、three-mesh-bvh、Zustand、React** 及其贡献者：渲染、构建和口腔模块依赖。

各项第三方资源的来源及许可应分别保留，不能用 BodyVista 的项目署名替代原作者署名。

## 👥 贡献者

<table>
  <tr>
    <td align="center">
      <a href="https://github.com/MarkMaMed">
        <img src="https://github.com/MarkMaMed.png?size=160" width="80" height="80" alt="MarkMaMed"><br>
        <sub><b>MarkMaMed</b></sub>
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/rikka314">
        <img src="https://github.com/rikka314.png?size=160" width="80" height="80" alt="rikka314"><br>
        <sub><b>rikka314</b></sub>
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/WangRongsheng">
        <img src="https://github.com/WangRongsheng.png?size=160" width="80" height="80" alt="WangRongsheng"><br>
        <sub><b>WangRongsheng</b></sub>
      </a>
    </td>
  </tr>
</table>

欢迎通过 Issue 和 Pull Request 参与。提交前请运行 `npm test` 和 `npm run build`；新增可见文本时，请同步补齐中文、英文和日文。修改解剖或生理内容时，请附上可核对的参考来源。

## 📄 Licence

BodyVista 自有代码采用 **[MIT License](LICENSE)**。第三方代码、模型及改编教学内容不因本项目采用 MIT 而变更原有许可，详见 [第三方许可说明](THIRD_PARTY_NOTICES.md)。

第三方代码、模型与教学内容分别保留其原有许可：

- **Dental Scope 代码**：MIT，见 [`dental/vendor/LICENSE`](dental/vendor/LICENSE)。该文件同时说明了模型与教学内容的单独许可。
- **口腔模型与改编教学内容**：按 [CREDITS](dental/vendor/CREDITS.md)、[模型来源文档](dental/vendor/docs/assets.md) 和 [集成说明](dental/README.md) 中的逐项记录处理，包含 CC BY-SA 2.1 Japan 与 CC BY-SA 4.0 资源。
- **主站人体模型**：以 `catalog.json` 中的逐结构来源记录为核对依据。当前部分记录包含 `NC exceptions; research only` 标记，相关来源与公开分发范围尚待核实，不应直接视为统一、无附加限制的授权。
- **其他第三方库**：保留各自许可证与版权声明。

MIT 授权范围仅覆盖我们有权以该许可证发布的代码与文档，不包含第三方模型及另有许可的内容。
