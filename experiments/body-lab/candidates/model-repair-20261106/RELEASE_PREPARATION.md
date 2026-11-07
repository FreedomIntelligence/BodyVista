# 全身实验台正式发行准备

`prepare_release_bundle.py` 根据已经验收的本地输入，生成四份资源及安装器可读的小清单 `release-assets.json`。v1.1.0 的数值报告、正式网页报告及 11 项缓存目录具有相同的模型和计算身份。安装方法及来源归属见[发行资源说明](../../RELEASE_ASSETS.md)。

## 精确文件范围

| 发行资源 | 内容与核对依据 |
|---|---|
| 骨体积 | `geometry/bone-volumes.bin` 的原始字节，核对体积清单中的大小、哈希和 `fullbody-bones.json` 来源哈希 |
| 图谱表面 | `atlas-muscles.bin` 的原始字节，核对已审 460 表面选集、实际二进制哈希与配对骨体积哈希 |
| MS-Human 来源 ZIP | `candidates/ms-human-700/SOURCE_MANIFEST.json` 及其中列出的全部 251 个文件，共 252 项。固定来源提交 `98a70c569c4c1b6da467a20012f766ee1f8dc521`，来源清单 SHA-256 `398c7173af58e726098997c1c3c483c809d952337399cb26a0be1cda990dc5f8`。派生 XML 直接引用的网格必须在安装清单中 |
| 动作缓存 ZIP | `motion-cache/catalog.json` 和它逐项引用的 11 个 gzip。核对解压后的内容哈希、最终模型与计算身份、场景、已验证结果及 803 帧，有旧结果文件的目录也只取当前目录所引用的文件 |

以上安装目标均以 `experiments/body-lab/` 为起点。每个 ZIP 成员则使用安装器要求的完整仓库相对路径。打包器逐文件输出字节数和 SHA-256。Subito 历史研究代码和作者来源不属于这四份资源，也不是 v5 Franko 传动的发行前置条件。

## 打包规格

维护者可以先用规格生成器列出实际入口、计算模块、Git 文件和缺项。此步骤只读取已检出的工作树，不创建规格或写入通过状态。下例使用 v1.1.0 标签。

```powershell
python -B -X utf8 experiments/body-lab/make_release_spec.py --tag v1.1.0 --list-files
```

待同版文件进入最终 Git 提交，使用生成器读取引擎配置、依赖的 XML／manifest 和右臂图谱绑定，并生成精确的本地 JSON。指定的 Git 提交须提供清单内全部文件；若运行入口确实新增了其他依赖，可重复使用 `--extra-file <仓库相对路径>`。字段如下。

| 字段 | 填写内容 |
|---|---|
| `releaseTag`、`sourceCommit` | 固定发行标签和已包含全部 `requiredFiles` 的 40 位 Git 提交号 |
| `modelXml` | 实际活动 XML。当前正式树使用 `experiments/body-lab/candidates/runtime/expanded-motion-repair.xml` |
| `modelManifest` | 与活动 XML 配对的最终声明。v5 使用独立的 `experiments/body-lab/candidates/runtime/expanded-motion-repair-v5-manifest.json`，文件名没有按 XML 同名推导 |
| `computationFiles` | 按最终 `fullbody_engine.computation_fingerprint()` 中的顺序填写，路径相对 `experiments/body-lab/`。生成器从实际引擎逐项读取，保留原顺序。新路线在 `franko_transmission.py` 后加入 `passive_series.py`，列表长度随引擎声明确定 |
| `atlasLicense` | 已随工作树保留的[上游原署名与许可](../../licenses/Z-Anatomy-License.txt)。原文使用 CRLF，SHA-256 为 `9304fab639baf94d709b0b68a173b0302b18d6c0e64dabfd8e258b76a2636942`。同一文本的 LF 表示 SHA-256 为 `af62c06f620b9da20138e4c22a3f56565482dd058266540994ace97a4e24b693` |
| `requiredFiles` | 同版 Git 提供的逐文件仓库相对路径。列入最终网页入口及其实际加载模块、HTTP 服务、求解及安装／打包代码、模型 XML、派生与父版本 manifest、配套 JSON、正式全身报告、适用许可和归属文件。v5 还须列入 `baseModelManifest.file` 指向的 v4 基础记录、实际选定的 Franko 模块、FDS 被动串联模块及其正式说明 |

打包器检查工作树文件是否由 `sourceCommit` 提供，并按 `core.autocrlf=false` 核对检出字节。实验目录的代码、XML、清单等保留计算和来源验证使用的精确字节。根 README、代码许可证和主站 JavaScript 若只因 Git 换行表示而不同，安装清单采用同一提交在干净副本的实际检出哈希。这允许直接在 Windows 工作树准备资源。

v5 的 XML 哈希可与 v4 相同。实际传动身份还取决于 v5 manifest、它明确引用的 v4 基础 manifest 和真实计算模块。打包器要求声明为 `selected`，核对 `transmissionModuleSha256` 与 Franko 模块，并将 `effectiveTendonTransmission.passiveSeries.moduleSha256` 与 `passive_series.py` 的实际字节核对。两个模块均须出现在完整计算指纹内。双侧小指六个屈曲轴和八个 FDS 单元的最终声明以同版引擎和验收证据为准。正式 `model-ready-for-library.json` 可以作为本地构建输入，不需要把含本机运行信息的原记录作为公共下载素材。

## 生成与核验

运行 `python -B -X utf8 experiments/body-lab/make_release_spec.py --tag v1.1.0 --git-files` 可输出逐行 Git 路径，不操作暂存区。它包含五个固定回归套件输入、两份原始场景索引及其 11 个场景、两个可导入示例、当前工具与测试。历史计算输出、受保护的本地就绪记录及四份 Release 资源均排除。原几何校准 XML 是校验器需要的具名输入，其中上游资产路径的历史工作区前缀按固定哈希保留，并在读取时解析到当前来源包。

需 Git 和 Python 3.13。对应代码已经提交、正式就绪标记和 11 个重新验算的缓存齐备后，从该工作树根目录执行。生成器只创建 `.runtime-cache/release-bundle-specs/` 下的小规格文件，提交号取自真实 Git 对象。打包器再独立核对验证报告、物理模型与动作版本。正式就绪标记须有明确的 `ready:true` 和 `publicationValidated:true`。覆盖、数值和网页报告都要匹配相同的模型 ID、XML 和计算哈希。网页报告须记录 `status:passed`、`candidatePreview:false`、`fixedCacheValidated:true` 及带时区完成时间。每个缓存帧使用与缓存构建器相同的力账验证函数，肌腱和独立坐标的预期集合取自冻结 XML，分支、手指参考坐标取自模型声明。

```powershell
$ReleaseBundleSpec = python -B -X utf8 experiments/body-lab/make_release_spec.py --tag v1.1.0 --commit HEAD
if ($LASTEXITCODE -ne 0) { throw '生成发行规格失败' }
python -B -X utf8 experiments/body-lab/prepare_release_bundle.py --spec $ReleaseBundleSpec
```

输出在 `.runtime-cache/release-bundles/<tag>/`。两个 ZIP 按路径排序，固定 ZIP 时间为 1980-01-01、权限为 0644，使用 stored 格式。相同输入可以逐字节比较。已有标签目录会保留。输出的小清单符合 `setup_release_assets.py` 的 schema 1，含真实资源名、固定 URL、包哈希和逐文件哈希。准备小清单后仍须实际验证干净安装、网页启动和最终发行资产。

## 460 个肌肉／跟腱表面的许可结论

图谱选集为 458 个肌肉和 2 条跟腱。已有来源核对包括从仓库 GLB 到选集数据的 SHA 对应，以及 Z-Anatomy、BodyParts3D 名称、作者、许可和项目修改。该选集按 CC BY-SA 4.0 发行，保留 BodyParts3D 的 CC BY-SA 2.1 Japan 归属。官方许可列出的内耳和肾模型例外不属于本选集。原始导出记录缺少可唯一绑定的上游几何版本，应保留这项追溯边界。[Z-Anatomy 上游许可](https://github.com/Z-Anatomy/Models-of-human-anatomy/blob/5a07944a0c73f4802450ec6d2adb4a171e8cdb30/License.txt) · [本项目资源归属](../../ASSET_ATTRIBUTION.md)

MS-Human 来源包保留固定提交及 Apache-2.0 原许可。Franko 等人的单关节力臂来自 2011 年论文 *Moment arms of the human digital flexors* 的表 2。八个 FDS 单元的被动串联弹性沿用 OpenSim 4.6 Thelen 曲线的默认肌腱应变 0.04。最终选定模块承担这些参数到本模型的应用与假设，来源见[OpenSim 4.6 原始实现](https://github.com/opensim-org/opensim-core/blob/4.6/OpenSim/Actuators/Thelen2003Muscle.cpp#L165-L171)。论文全文、截图或补充材料不属于四份资源的成员。[PubMed 书目信息](https://pubmed.ncbi.nlm.nih.gov/21561624/) · [论文及表 2](https://pmc.ncbi.nlm.nih.gov/articles/PMC3124620/)
