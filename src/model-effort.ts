export const effortNames=['minimal','low','medium','high','xhigh','max'];
export function modelEfforts(model:{reasoning:boolean;efforts?:string[];compat?:any}){
  if(!model.reasoning)return [];
  const configured=(model.efforts??['low','medium','high','max']).filter(e=>effortNames.includes(e));
  return [...(['qwen','qwen-chat-template','deepseek','zai','chat-template'].includes(model.compat?.thinkingFormat)?['off']:[]),...new Set(configured)];
}
export function defaultEffort(model:Parameters<typeof modelEfforts>[0]){
  const choices=modelEfforts(model);return choices.includes('medium')?'medium':choices.find(e=>e!=='off')??choices[0];
}
