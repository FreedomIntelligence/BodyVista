// Match only actual atlas teeth; jaw bones and nearby nerves must not inherit tooth information.
export function dentalFDI(part) {
 if(part?.knowledge?.category!=='牙')return null;
 const match=/^(upper|lower) (medial incisor|central incisor|lateral incisor|canine|first premolar|second premolar|first molar(?: tooth)?|second molar(?: tooth)?|third molar(?: tooth)?) (left|right)$/.exec(part.english||'');
 if(!match)return null;
 const [,arch,type,side]=match;
 const quadrant=arch==='upper'?(side==='right'?1:2):(side==='right'?4:3);
 const position={'medial incisor':1,'central incisor':1,'lateral incisor':2,canine:3,'first premolar':4,'second premolar':5,'first molar':6,'second molar':7,'third molar':8}[type.replace(/ tooth$/,'')];
 return quadrant*10+position;
}

// Reuse the oral workspace's localized teaching text in the atlas knowledge panel.
export const dentalTissues = [
 {title:'牙体结构',items:[
 ['牙釉质','牙釉质覆盖牙冠表面，保护内部的牙本质。'],
 ['牙本质','牙本质位于牙釉质和牙骨质内侧，包围牙髓腔。'],
 ['牙骨质','牙骨质覆盖牙根表面，为牙周韧带提供附着。'],
 ['牙髓','牙髓位于牙齿内部，包含血管、神经和结缔组织。'],
 ['根管','根管是牙根内牙髓腔的延续，向根尖方向延伸。'],
 ]},
 {title:'支持组织',items:[
 ['牙龈','牙龈围绕牙颈部，覆盖牙槽突表面。'],
 ['牙周韧带','牙周韧带连接牙根表面与牙槽骨，将牙齿固定在牙槽内。'],
 ['牙槽骨','牙槽骨形成容纳牙根的牙槽，与牙周韧带共同支持牙齿。'],
 ]},
];

export function dentalRelated(part,parts){
 const fdi=dentalFDI(part);if(!fdi)return null;
 const q=Math.floor(fdi/10),n=fdi%10,opposite={1:2,2:1,3:4,4:3}[q];
 const byFDI=new Map(parts.map(p=>[dentalFDI(p),p]).filter(([id])=>id));
 const result=[];
 const add=(p,relation)=>{if(p&&p.id!==part.id&&!result.some(item=>item.part.id===p.id))result.push({part:p,relation});};
 // Across the midline, the opposite central incisor is also the direct neighbor.
 add(byFDI.get(n===1?opposite*10+1:fdi-1),'相邻牙');
 add(byFDI.get(fdi+1),'相邻牙');
 add(byFDI.get(opposite*10+n),'对侧同名牙');
 const jaw=q<=2?`maxilla ${q===1?'right':'left'}`:'mandible';
 add(parts.find(p=>p.english===jaw),'对应颌骨');
 return result;
}
