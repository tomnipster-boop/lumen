import lumenMark from "../assets/lumen-mark.svg";

export function StartupSplash() {
  return (
    <div className="startup-splash" role="status" aria-label="Opening Lumen">
      <div className="startup-splash__mark" aria-hidden="true">
        <img src={lumenMark} alt="" draggable={false} />
      </div>
      <span className="visually-hidden">Opening Lumen</span>
    </div>
  );
}
