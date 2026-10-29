const rows = `
心脏搏动|Heartbeat|心拍
心脏瓣膜开闭时序|Heart valve cycle|心臓弁の開閉
肺循环路径|Pulmonary circulation|肺循環の経路
体循环主要通路|Systemic circulation|体循環の主な経路
心脏、瓣膜与血流联动|Heart, valves and blood flow|心臓・弁・血流の連動
心室扭转与舒张回弹|Ventricular twist and recoil|心室のねじれと拡張期の復元
动脉脉搏波传播|Arterial pulse wave|動脈の脈波伝播
静脉回流与呼吸性变化|Venous return and breathing|静脈還流と呼吸性変化
心搏与呼吸位移联动|Heartbeat and respiratory motion|心拍と呼吸運動の連動
心肌收缩与冠脉舒张期灌注|Contraction and coronary perfusion|心筋収縮と拡張期の冠灌流
心室早期充盈与心房助推|Ventricular filling and atrial contraction|心室充満と心房収縮
主动脉扩张与弹性回缩|Aortic expansion and recoil|大動脈の拡張と弾性収縮
吞咽时的会厌倾转|Epiglottis during swallowing|嚥下時の喉頭蓋の動き
食管蠕动|Esophageal peristalsis|食道の蠕動
胃壁节律收缩|Rhythmic stomach contraction|胃壁の律動的収縮
消化道推进顺序|Digestive tract transport|消化管の輸送順序
胆汁进入肠道的通路|Bile route to the intestine|胆汁が腸へ進む経路
唾液腺与导管|Salivary glands and ducts|唾液腺と導管
胃壁推进波与搅拌|Stomach propulsion and mixing|胃の蠕動と攪拌
小肠分节运动|Intestinal segmentation|小腸の分節運動
小肠局部蠕动|Intestinal peristalsis|小腸の蠕動
结肠袋交替收缩|Haustral contractions|結腸膨起の交互収縮
胆囊缓慢收缩与恢复|Gallbladder contraction|胆嚢の収縮と復元
舌、咽、会厌与食管联动|Coordinated swallowing|舌・咽頭・喉頭蓋・食道の連動
胃肠节律联动|Gastrointestinal coordination|胃腸の律動的連動
吞咽时喉部抬升与会厌联动|Laryngeal elevation during swallowing|嚥下時の喉頭挙上と喉頭蓋
舌体推进与舌根接续|Tongue propulsion|舌体と舌根の送り込み
唾液沿导管进入口腔|Salivary flow to the mouth|導管から口腔への唾液輸送
胆囊收缩与胆汁输送|Bile release|胆嚢収縮と胆汁輸送
胰液沿胰管输送|Pancreatic fluid transport|膵管内の膵液輸送
结肠顺序推进|Colonic propulsion|結腸の順次輸送
肝脏随呼吸下降与回升|Liver motion during breathing|呼吸に伴う肝臓の移動
垂体与甲状腺反馈|Pituitary–thyroid feedback|下垂体と甲状腺のフィードバック
主要内分泌腺巡览|Endocrine gland tour|主な内分泌腺
内分泌信号释放|Endocrine signaling|内分泌シグナルの放出
垂体与甲状腺信号往返|Pituitary–thyroid signaling|下垂体と甲状腺の信号
垂体与肾上腺调节|Pituitary–adrenal regulation|下垂体と副腎の調節
体表胸腹呼吸起伏|Chest and abdominal breathing|胸腹部の呼吸運動
腹式呼吸的体表起伏|Abdominal breathing|腹式呼吸の体表運動
淋巴结区域巡览|Lymph node regions|リンパ節の部位
免疫相关器官对照|Immune organs|免疫に関わる器官
淋巴结内细胞巡行|Cell motion in lymph nodes|リンパ節内の細胞の動き
脾内免疫细胞活动|Immune cells in the spleen|脾臓内の免疫細胞
扁桃体局部免疫活动|Tonsillar immune activity|扁桃の免疫活動
精子运输相关结构|Sperm transport structures|精子輸送に関わる構造
男性附属腺位置|Male accessory glands|男性の付属腺の位置
输精管平滑肌推进波|Vas deferens propulsion|精管の平滑筋による輸送
输精管与射精管接续推进|Male reproductive transport|精管と射精管の輸送
肱二头肌与肱三头肌|Biceps and triceps|上腕二頭筋と上腕三頭筋
股前与股后肌群|Anterior and posterior thigh muscles|大腿前面と後面の筋群
小腿前后肌群|Anterior and posterior leg muscles|下腿前面と後面の筋群
膈肌吸气运动|Diaphragm during inhalation|吸気時の横隔膜運動
膈肌、肋间肌与腹壁联动|Respiratory muscle coordination|横隔膜・肋間筋・腹壁の連動
肌腹收缩与肌腱端固定|Muscle belly contraction|筋腹の収縮と腱付着部
眨眼相关肌群交替活动|Blinking muscles|まばたきに関わる筋群
咀嚼肌节律收缩|Rhythmic chewing muscles|咀嚼筋の律動的収縮
屈肘与伸肘肌群连续交替|Elbow muscle antagonists|肘の屈筋と伸筋の交互活動
屈指与伸指肌群|Finger flexors and extensors|指の屈筋と伸筋
背屈与跖屈肌腹活动|Ankle muscle antagonists|背屈筋と底屈筋の活動
伸膝与屈膝肌腹活动|Knee muscle antagonists|膝の伸筋と屈筋の活動
喉部开闭肌群配合|Laryngeal muscle coordination|喉頭筋の協調
双眼水平注视肌群配合|Horizontal gaze muscles|水平注視に関わる筋群
微笑时的颧肌收缩|Zygomatic muscles during smiling|微笑時の頬骨筋の収縮
口轮匝肌收缩|Orbicularis oris contraction|口輪筋の収縮
上肢神经分布顺序|Upper limb nerves|上肢の神経分布
脊髓前后角功能对照|Spinal cord horns|脊髄の前角と後角
神经信号沿纤维传播|Nerve impulse propagation|神経線維に沿う信号伝達
脊髓反射：感觉传入与运动传出|Spinal reflex arc|脊髄反射：感覚入力と運動出力
视觉信号向中枢传递|Visual pathway|中枢への視覚信号伝達
下行运动信号|Descending motor signals|下行性運動信号
肺的吸气与呼气|Inhalation and exhalation|肺の吸気と呼気
空气进入肺的路径|Airway route|肺に空気が入る経路
肺叶、支气管与气流联动|Lungs, bronchi and airflow|肺葉・気管支・気流の連動
深吸气与缓慢呼气|Deep breathing|深い吸気とゆっくりした呼気
叹息样呼吸节律|Sighing rhythm|ため息の呼吸リズム
咳嗽：吸气、蓄压与快速呼气|Cough cycle|咳：吸気・加圧・急速な呼気
发声时的呼气与喉软骨联动|Breathing during phonation|発声時の呼気と喉頭軟骨
气道黏液向咽部运输|Airway mucus transport|気道粘液の咽頭への輸送
杓状软骨开合|Arytenoid cartilage motion|披裂軟骨の開閉
双眼左右注视|Horizontal eye movement|両眼の左右運動
双眼上下转动|Vertical eye movement|両眼の上下運動
晶状体调节|Lens accommodation|水晶体の調節
瞳孔缩小与恢复|Pupil constriction and recovery|瞳孔の縮小と回復
鼓膜与听小骨振动|Eardrum and ossicle vibration|鼓膜と耳小骨の振動
泪液引流路径|Tear drainage route|涙液の排出経路
近反应：会聚、调节与缩瞳|Near response|近見反応：輻輳・調節・縮瞳
双眼快速扫视与停留|Eye saccades and fixation|両眼のサッカードと停留
双眼平滑追踪|Smooth eye pursuit|両眼の滑動性追従
鼓膜振型与听骨链传递|Eardrum and ossicular transmission|鼓膜振動と耳小骨連鎖
泪液引流方向|Tear drainage|涙液の排出方向
瞳孔快速缩小与缓慢恢复|Pupil light adaptation|瞳孔の急速な縮小と緩やかな回復
阅读时的扫视与回扫|Reading saccades|読書時のサッカード
吞咽时咽鼓管开放|Auditory tube during swallowing|嚥下時の耳管開放
肩关节前屈|Shoulder flexion|肩関節の屈曲
肩关节外展|Shoulder abduction|肩関節の外転
肘关节屈伸|Elbow flexion and extension|肘関節の屈曲と伸展
腕关节掌屈|Wrist flexion|手関節の掌屈
髋关节前屈|Hip flexion|股関節の屈曲
髋关节外展|Hip abduction|股関節の外転
膝关节屈伸|Knee flexion and extension|膝関節の屈曲と伸展
踝关节背屈|Ankle dorsiflexion|足関節の背屈
头部点头|Head nodding|頭部のうなずき
头部左右转动|Head rotation|頭部の左右回旋
下颌张口与闭口|Jaw opening and closing|下顎の開口と閉口
前臂旋前与旋后|Forearm pronation and supination|前腕の回内と回外
腕关节桡偏与尺偏|Wrist deviation|手関節の橈屈と尺屈
肩关节平滑环转|Shoulder circumduction|肩関節の分回し
踝关节跖屈与回位|Ankle plantarflexion|足関節の底屈と復元
髋关节小幅环转|Hip circumduction|股関節の分回し
步行摆腿与对侧摆臂|Walking arm and leg swing|歩行時の脚と対側の腕の振り
手指分节屈曲|Finger flexion|手指の屈曲
足趾分节屈曲|Toe flexion|足趾の屈曲
呼吸时肋骨与胸骨运动|Ribs and sternum during breathing|呼吸時の肋骨と胸骨
下颌旋转、前移与咀嚼|Jaw motion and chewing|下顎の回転・前進・咀嚼
髋膝踝协同屈伸|Squat coordination|股・膝・足関節の協調した屈伸
骑行样髋膝交替运动|Cycling motion|ペダリング時の股・膝関節運動
髋关节内旋|Hip internal rotation|股関節の内旋
髋关节外旋|Hip external rotation|股関節の外旋
足部内翻与外翻|Foot inversion and eversion|足部の内反と外反
伸手：肩肘腕连续配合|Reaching motion|手を伸ばす動作の連動
腕关节环转|Wrist circumduction|手関節の分回し
输尿管蠕动|Ureter peristalsis|尿管の蠕動
膀胱充盈与排空|Bladder filling and emptying|膀胱の充満と排出
尿液排出通路|Urinary route|尿の排出経路
左右输尿管交错蠕动|Alternating ureter peristalsis|左右の尿管の交互蠕動
输尿管推进与膀胱充盈|Ureter transport and bladder filling|尿管の輸送と膀胱充満
膀胱壁收缩与排尿通路|Micturition|膀胱壁の収縮と排尿
肾脏随呼吸移动|Kidney respiratory motion|呼吸に伴う腎臓の移動
肾盂与输尿管接续收缩|Renal pelvis and ureter contraction|腎盂と尿管の連続収縮
`;
export default Object.fromEntries(rows.trim().split('\n').map(row => { const [zh,en,ja] = row.split('|'); return [zh,[en,ja]]; }));
