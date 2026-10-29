export const strings = {
 '口腔与牙齿':['Mouth & teeth','口腔と歯'],
 '牙齿分层、剖切与牙弓观察':['Tooth layers, sections and dental arches','歯の層・断面・歯列の観察'],
 '开合口与咬合':['Jaw opening & occlusion','開閉口と咬合'],
 '牙齿发育':['Dental development','歯の発育'],
 '返回头部':['Back to head','頭部に戻る'],
 '返回生命律动':['Back to Life in Motion','生命のリズムに戻る'],
 '加载中...':['Loading...','読み込み中...'],
 '加载失败，请重试':['Loading failed. Please retry.','読み込みに失敗しました。再試行してください。'],
 '重试':['Retry','再試行'],
 '牙列':['Dentition','歯列'],
 '上颌':['Upper jaw','上顎'], '下颌':['Lower jaw','下顎'],
 '选择牙齿':['Choose a tooth','歯を選択'],
 '单独查看':['Inspect tooth','歯を詳しく見る'],
 '完整牙列':['Full dentition','歯列全体'],
 '牙齿层次':['Tooth layers','歯の層'],
 '完整牙齿':['Whole tooth','歯全体'],
 '牙周组织':['Periodontium','歯周組織'],
 '牙本质':['Dentin','象牙質'], '牙髓':['Dental pulp','歯髄'], '根管':['Root canals','根管'],
 '牙弓分离':['Separate arches','歯列を分離'],
 '剖切':['Section','断面'], '关闭':['Off','オフ'],
 '矢状面':['Sagittal','矢状面'], '冠状面':['Coronal','冠状面'], '横切面':['Axial','横断面'],
 '切面位置':['Section position','断面の位置'],
 '正面':['Front','正面'], '侧面':['Side','側面'], '咬合面':['Occlusal','咬合面'],
 '复位':['Reset view','視点をリセット'], '截图':['Screenshot','スクリーンショット'],
 '控制面板':['Controls','操作パネル'], '播放':['Play','再生'], '暂停':['Pause','一時停止'],
 '开口程度':['Jaw opening','開口量'],
 '发育阶段':['Development stage','発育段階'],
 '成人':['Adult','成人'], '显示未萌出牙':['Show unerupted teeth','未萌出歯を表示'],
 '显示软组织':['Show soft tissue','軟組織を表示'],
 '教学示意，不能用于判断个体发育年龄。':['Teaching model; not for assessing an individual’s dental age.','教育用の模式モデルです。個人の歯の発育年齢の判定には使えません。'],
 '内容与模型来源':['Content & model credits','コンテンツとモデルの出典'],
 '模型与内容经过适配；教学内容待专业审核。':['Models and content adapted; educational content awaits expert review.','モデルと内容を調整しています。教材内容は専門家による確認待ちです。'],
 '定位结构':['Focus structure','構造にフォーカス'], '问 ChatGPT':['Ask ChatGPT','ChatGPTに質問'], '问 DeepSeek':['Ask DeepSeek','DeepSeekに質問'],
 '牙齿由外部硬组织包围内部牙髓；切换层次可以观察不同组织之间的关系。':['Hard tissues surround the dental pulp. Change layers to explore their relationships.','歯の内部にある歯髄を硬組織が囲んでいます。層を切り替えて組織同士の関係を観察できます。'],
 '牙周组织围绕牙根，连接并支持牙齿。':['Periodontal tissues surround the roots and attach and support the tooth.','歯周組織は歯根を取り囲み、歯を支持しています。'],
 '牙本质位于牙釉质和牙骨质内侧，包围牙髓腔。':['Dentin lies beneath enamel and cementum and surrounds the pulp cavity.','象牙質はエナメル質とセメント質の内側にあり、歯髄腔を囲みます。'],
 '牙髓位于牙齿内部，包含血管、神经和结缔组织。':['The pulp lies inside the tooth and contains blood vessels, nerves and connective tissue.','歯髄は歯の内部にあり、血管・神経・結合組織を含みます。'],
 '根管是牙根内牙髓腔的延续，向根尖方向延伸。':['Root canals continue the pulp cavity through the roots toward their tips.','根管は歯髄腔から歯根内へ続き、根尖に向かって伸びています。'],
 '牙齿资料':['Tooth reference','歯の参考資料'],
};
export const translate = (key,lang) => lang === 'en' ? strings[key]?.[0] ?? key : lang === 'ja' ? strings[key]?.[1] ?? key : key;
export function toothName(fdi,lang){
 const q=Math.floor(fdi/10),n=fdi%10,primary=q>4,quad=primary?q-4:q;
 const names=[['中切牙','central incisor','中切歯'],['侧切牙','lateral incisor','側切歯'],['尖牙','canine','犬歯'],['第一前磨牙','first premolar','第一小臼歯'],['第二前磨牙','second premolar','第二小臼歯'],['第一磨牙','first molar','第一大臼歯'],['第二磨牙','second molar','第二大臼歯'],['第三磨牙','third molar','第三大臼歯']];
 const row=names[(primary&&n>=4?n+2:n)-1]; if(!row)return String(fdi);
 const upper=quad<=2,right=quad===1||quad===4;
 if(lang==='en')return `${primary?'Primary ':''}${upper?'Upper':'Lower'} ${right?'right':'left'} ${row[1]}`;
 return lang==='ja'?`${upper?'上顎':'下顎'}${right?'右側':'左側'}${primary?'乳':''}${row[2]}`:`${upper?'上颌':'下颌'}${right?'右侧':'左侧'}${primary?'乳':''}${row[0]}`;
}
