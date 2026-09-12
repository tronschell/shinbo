import React from "react";
import {
  AbsoluteFill,
  Audio,
  Composition,
  Easing,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  registerRoot,
  staticFile,
  useCurrentFrame,
} from "remotion";

const FPS = 30;
const seconds = 60;
const plates = [
  "1787967355248",
  "1787967338338",
  "1787967329609",
  "1787967317892",
  "1787967306638",
  "1787880311523",
  "1787880169902",
  "1787880118554",
  "1787879057855",
];
const ease = (f: number, a = 0, b = 24) =>
  interpolate(f, [a, b], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.2, 0.8, 0.2, 1),
  });
const mono: React.CSSProperties = {
  fontFamily: "Departure",
  fontSize: 24,
  letterSpacing: 3,
};

function Backdrop({ plate = 0 }: { plate?: number }) {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: "#111311" }}>
      <Img
        src={staticFile(`backgrounds/dither-${plates[plate]}.png`)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          imageRendering: "pixelated",
          transform: `scale(${1.04 + f / 18000}) translateX(${Math.sin(f / 150) * 12}px)`,
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(90deg,rgba(12,15,17,.67),rgba(12,15,17,.12))",
        }}
      />
    </AbsoluteFill>
  );
}

function Title() {
  const f = useCurrentFrame();
  const p = ease(f, 0, 32);
  return <AbsoluteFill>
    <Backdrop plate={7} />
    <Img src={staticFile("shinbo-logo.svg")} style={{position:"absolute",width:1500,height:1500,left:1170,top:260,objectFit:"contain",opacity:p,transform:`translateY(${(1-p)*65}px) scale(${0.92+p*0.08})`}} />
    <div style={{position:"absolute",top:1460,left:0,right:0,textAlign:"center",fontSize:46,color:"#f9faef",letterSpacing:-1,opacity:ease(f,20,42)}}>shinbo.app</div>
  </AbsoluteFill>;
}

type ShotProps = {
  file: string;
  title: string;
  sub?: string;
  plate: number;
  start?: number;
  rate?: number;
  zoom?: number;
  focus?: string;
};
function Shot({
  file,
  title,
  sub,
  plate,
  start = 0,
  rate = 1,
  zoom = 1,
  focus = "50% 50%",
}: ShotProps) {
  const f = useCurrentFrame();
  const p = ease(f, 0, 22);
  const artifact = file === "result.mp4" || file === "interact.mp4";
  return (
    <AbsoluteFill>
      <Backdrop plate={plate} />
      <div
        style={{
          position: "absolute",
          left: 150,
          top: 245,
          opacity: p,
          transform: `translateY(${(1 - p) * 35}px)`,
        }}
      >
        <div
          style={{
            fontSize: 103,
            fontWeight: 530,
            letterSpacing: -5,
            color: "#fbfcf5",
            lineHeight: 1.1,
          }}
        >
          {title}
        </div>
        {sub && (
          <div style={{ fontSize: 34, color: "#e4e9dd", marginTop: 25 }}>
            {sub}
          </div>
        )}
      </div>
      <div
        style={{
          position: "absolute",
          left: 620,
          right: 620,
          top: title ? 430 : 230,
          height: artifact ? 1525 : 1620,
          borderRadius: 28,
          overflow: "hidden",
          background: "#101113",
          boxShadow: "0 80px 150px #0008, 0 0 0 2px #ffffff38",
          opacity: p,
          transform: `translateY(${(1 - p) * 100}px) scale(${0.97 + 0.03 * p})`,
        }}
      >
        <OffthreadVideo
          muted
          src={staticFile(`captures/${file}`)}
          startFrom={Math.round(start * FPS)}
          playbackRate={rate}
          style={{
            position: "absolute",
            left: artifact ? "-35.24%" : "-4.058%",
            top: artifact ? "-42.82%" : "-4.419%",
            width: artifact ? "170.71%" : "108.116%",
            height: artifact ? "188.74%" : "113.023%",
            objectFit: "fill",
            objectPosition: focus,
            transform: `scale(${zoom + f * 0.000035})`,
            transformOrigin: focus,
          }}
        />
      </div>
    </AbsoluteFill>
  );
}

function Models() {
  const f = useCurrentFrame();
  const logos = ["openai.svg", "claude.svg", "gemini.png", "deepseek.svg", "qwen.svg", "zai.svg", "meta.svg", "mistralai.svg", "openrouter.svg"];
  const routes = ["Subscriptions", "Direct APIs", "OpenRouter", "Local models"];
  return <AbsoluteFill style={{color: "#fbfcf5"}}>
    <Backdrop plate={2} />
    <div style={{position:"absolute",left:150,top:245,fontSize:120,letterSpacing:-6,fontWeight:530}}>Your models. One Shinbo.</div>
    <div style={{position:"absolute",left:190,top:560,width:1900,height:1110,borderRadius:28,overflow:"hidden",boxShadow:"0 60px 140px #0008, 0 0 0 2px #ffffff38"}}>
      <Sequence from={0} durationInFrames={135}><OffthreadVideo muted src={staticFile("captures/model-reel.mp4")} style={{position:"absolute",left:"-30.36%",top:"-91.43%",width:"207.65%",height:"231.43%"}} /></Sequence>
      <Sequence from={135} durationInFrames={135}><OffthreadVideo muted src={staticFile("captures/model-routes.mp4")} style={{position:"absolute",left:"-66.3%",top:"-58.76%",width:"206.93%",height:"236.5%"}} /></Sequence>
    </div>
    <div style={{position:"absolute",left:2320,top:660,display:"grid",gap:95}}>
      {routes.map((route,i)=><div key={route} style={{opacity:ease(f,i*23,i*23+18),transform:`translateX(${(1-ease(f,i*23,i*23+18))*70}px)`,fontSize:83,letterSpacing:-3,display:"flex",alignItems:"center",gap:38}}>
        <span style={{...mono,color:"#d4cdeb",fontSize:27}}>0{i+1}</span>{route}
      </div>)}
    </div>
    <div style={{position:"absolute",left:0,right:0,bottom:95,height:200,overflow:"hidden",maskImage:"linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent)"}}>
      <div style={{display:"flex",gap:180,width:"max-content",transform:`translateX(${-f*5}px)`}}>
        {[...logos,...logos].map((logo,i)=><div key={i} style={{width:270,height:180,display:"flex",alignItems:"center",justifyContent:"center"}}><Img src={staticFile(`brands/${logo}`)} style={{width:125,height:125,objectFit:"contain"}} /></div>)}
      </div>
    </div>
  </AbsoluteFill>;
}

function Film() {
  const f = useCurrentFrame();
  return <AbsoluteFill style={{fontFamily:"Helvetica Neue, Arial, sans-serif",background:"#121617"}}>
    <style>{`@font-face{font-family:Departure;src:url('${staticFile("DepartureMono-Regular.woff2")}')}`}</style>
    <Audio src={staticFile("score.wav")} volume={0.65} />
      <Sequence from={0} durationInFrames={150}><Shot file="prompt.mp4" title="" plate={0} /></Sequence>
      <Sequence from={150} durationInFrames={120}><Shot file="plan.mp4" title="A plan that delegates." plate={0} /></Sequence>
      <Sequence from={270} durationInFrames={120}><Shot file="delegation.mp4" title="Subagents, in parallel." plate={1} /></Sequence>
      <Sequence from={390} durationInFrames={150}><Shot file="browser.mp4" title="Research beside the conversation." plate={3} /></Sequence>
      <Sequence from={540} durationInFrames={120}><Shot file="reply.mp4" title="Follow the work as it happens." plate={6} /></Sequence>
      <Sequence from={660} durationInFrames={180}><Shot file="result.mp4" title="Build the tools you need." plate={1} /></Sequence>
      <Sequence from={840} durationInFrames={270}><Models /></Sequence>
      <Sequence from={1110} durationInFrames={120}><Shot file="plugins.mp4" title="Your tools, connected." plate={4} /></Sequence>
      <Sequence from={1230} durationInFrames={210}><Shot file="workflow.mp4" title="Scheduled work. With decisions." plate={5} zoom={1.2} focus="65% 40%" /></Sequence>
      <Sequence from={1440} durationInFrames={210}><Shot file="interact.mp4" title="From an idea to a working tool." plate={8} /></Sequence>
      <Sequence from={1650} durationInFrames={150}><Title /></Sequence>
    <div style={{position:"absolute",bottom:0,height:5,background:"#d6e3c6",width:`${f/(seconds*FPS)*100}%`,opacity:0.65}} />
  </AbsoluteFill>;
}

registerRoot(() => <Composition id="Shinbo4K" component={Film} width={3840} height={2160} fps={FPS} durationInFrames={seconds*FPS} />);
