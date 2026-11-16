import pieIcon from './pie-treat.png';

export const pieLabel = 'PIE’s treat';

export function PieSignature() {
  return <div className="pie-signature">
    <img src={pieIcon} alt="" width={38} height={30}/>
    <span>{pieLabel}</span>
  </div>;
}
