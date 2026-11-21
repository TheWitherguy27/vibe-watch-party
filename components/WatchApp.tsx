"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, configured, ensureGuestSession } from "@/lib/supabase";
import { extractYouTubeId, videoThumb } from "@/lib/youtube";
import { Plus, Users, Radio, Link2, Send, Play, Pause, SkipForward, Volume2, Settings2, MessageCircle, ListVideo, Crown, Sparkles, Copy, Check, LogOut, Sun, Moon, MonitorPlay, X } from "lucide-react";

type Party = {id:string; code:string; name:string; host_id:string; current_video_id:string|null; is_locked:boolean; participant_limit:number; playback_state:any};
type Member = {id:string; party_id:string; user_id:string; username:string; role:string; online:boolean};
type ChatMessage = {id:string; username:string; body:string; created_at:string};
type QueueItem = {id:string; video_id:string; title:string; added_by:string; position:number};
declare global { interface Window { YT:any; onYouTubeIframeAPIReady:()=>void } }

export default function WatchApp(){
  const [party,setParty]=useState<Party|null>(null), [member,setMember]=useState<Member|null>(null);
  const [members,setMembers]=useState<Member[]>([]), [messages,setMessages]=useState<ChatMessage[]>([]), [queue,setQueue]=useState<QueueItem[]>([]);
  const [name,setName]=useState("Alex"), [partyName,setPartyName]=useState("Friday Night Lounge"), [code,setCode]=useState("");
  const [chatText,setChatText]=useState(""), [videoUrl,setVideoUrl]=useState(""), [notice,setNotice]=useState(""), [tab,setTab]=useState<"chat"|"queue"|"people">("chat");
  const [theme,setTheme]=useState("dark"), [chatOpen,setChatOpen]=useState(true), [busy,setBusy]=useState(false), [copied,setCopied]=useState(false), [isHost,setIsHost]=useState(false);
  const player=useRef<any>(null), playerReady=useRef(false), suppress=useRef(false), channelRef=useRef<any>(null), chatEnd=useRef<HTMLDivElement>(null);
  const notify=(s:string)=>{setNotice(s); window.setTimeout(()=>setNotice(""),3200)};
  const currentId=party?.current_video_id || null;

  const loadRoom=useCallback(async(p:Party,m:Member)=>{
    if(!supabase)return;
    setParty(p);setMember(m);setIsHost(m.role==="host");
    const [{data:people},{data:chat},{data:items}]=await Promise.all([
      supabase.from("party_members").select("*").eq("party_id",p.id).eq("online",true).order("joined_at"),
      supabase.from("chat_messages").select("*").eq("party_id",p.id).order("created_at").limit(100),
      supabase.from("video_queue").select("*").eq("party_id",p.id).order("position")
    ]);
    setMembers(people||[]);setMessages(chat||[]);setQueue(items||[]);
  },[]);

  const joinByCode=async(raw:string)=>{
    if(!supabase){notify("Add your Supabase URL and anon key to .env.local first.");return;}
    setBusy(true);
    try { await ensureGuestSession(); } catch(e:any) { setBusy(false); notify(e.message); return; }
    const {data,error}=await supabase.rpc("join_party",{p_code:raw.trim(),p_username:name.trim()||"Guest"});
    setBusy(false);
    if(error||!data){notify(error?.message||"Party not found.");return;}
    const d=data as any; await loadRoom(d.party,d.member);
    window.history.replaceState({}, "", `/?party=${d.party.code}`);
  };
  const createParty=async()=>{
    if(!supabase){notify("Connect Supabase to create a live party.");return;}
    setBusy(true);
    try { await ensureGuestSession(); } catch(e:any) { setBusy(false); notify(e.message); return; }
    const {data,error}=await supabase.rpc("create_party",{p_name:partyName.trim()||"Watch Party",p_username:name.trim()||"Host"});
    setBusy(false);
    if(error||!data){notify(error?.message||"Could not create party.");return;}
    const d=data as any; await loadRoom(d.party,d.member);
    window.history.replaceState({}, "", `/?party=${d.party.code}`);
  };
  useEffect(()=>{
    if(!supabase)return;
    const q=new URLSearchParams(window.location.search).get("party");
    if(q) setCode(q);
  },[]);

  useEffect(()=>{
    if(!party||!member||!supabase)return;
    const ch=supabase.channel(`party-${party.id}`)
      .on("postgres_changes",{event:"*",schema:"public",table:"party_members",filter:`party_id=eq.${party.id}`},async()=>{
        const {data}=await supabase!.from("party_members").select("*").eq("party_id",party.id).eq("online",true).order("joined_at");setMembers(data||[]);
      })
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"chat_messages",filter:`party_id=eq.${party.id}`},payload=>{
        setMessages(prev=>prev.some(x=>x.id===payload.new.id)?prev:[...prev,payload.new as ChatMessage]);
      })
      .on("postgres_changes",{event:"*",schema:"public",table:"video_queue",filter:`party_id=eq.${party.id}`},async()=>{
        const {data}=await supabase!.from("video_queue").select("*").eq("party_id",party.id).order("position");setQueue(data||[]);
      })
      .on("postgres_changes",{event:"UPDATE",schema:"public",table:"parties",filter:`id=eq.${party.id}`},payload=>{
        const next=payload.new as Party;setParty(next);
        if(next.current_video_id && playerReady.current && player.current && player.current.getVideoData()?.video_id!==next.current_video_id) player.current.loadVideoById(next.current_video_id);
        const s=next.playback_state;if(s&&playerReady.current&&player.current){
          const target=(s.position||0)+Math.max(0,(Date.now()-new Date(s.updated_at).getTime())/1000)*(s.playing?1:0);
          if(Math.abs(player.current.getCurrentTime()-target)>2){suppress.current=true;player.current.seekTo(target,true);setTimeout(()=>suppress.current=false,900);}
          if(s.playing&&player.current.getPlayerState()!==1)player.current.playVideo();
          if(!s.playing&&player.current.getPlayerState()===1)player.current.pauseVideo();
        }
      }).subscribe();
    channelRef.current=ch;
    return ()=>{supabase!.removeChannel(ch);};
  },[party?.id,member?.id]);

  useEffect(()=>{
    if(!party||!currentId)return;
    const mount=()=>{
      if(!window.YT?.Player){setTimeout(mount,150);return;}
      const node=document.getElementById("youtube-player");if(!node)return;
      if(player.current){try{player.current.destroy()}catch{}}
      player.current=new window.YT.Player("youtube-player",{videoId:currentId,width:"100%",height:"100%",playerVars:{autoplay:1,controls:1,rel:0,playsinline:1,origin:window.location.origin},events:{
        onReady:()=>{playerReady.current=true;const s=party.playback_state;if(s?.position)player.current.seekTo(s.position,true);},
        onStateChange:(e:any)=>{if(!isHost||suppress.current||!supabase)return;if(e.data===1||e.data===2){publishPlayback(e.data===1);}},
      }});
    };
    if(!window.YT){const tag=document.createElement("script");tag.src="https://www.youtube.com/iframe_api";document.head.appendChild(tag);window.onYouTubeIframeAPIReady=mount;}else mount();
    return ()=>{playerReady.current=false;};
  },[party?.id,currentId,isHost]);

  const publishPlayback=async(playing:boolean)=>{
    if(!party||!supabase||!player.current)return;
    await supabase.from("parties").update({playback_state:{playing,position:player.current.getCurrentTime(),updated_at:new Date().toISOString()}}).eq("id",party.id);
  };
  const hostControl=async(action:"play"|"pause"|"sync")=>{
    if(!isHost||!player.current)return;
    if(action==="play")player.current.playVideo();if(action==="pause")player.current.pauseVideo();
    if(action==="sync"){const s=party?.playback_state;if(s)player.current.seekTo(s.position||0,true);}
    setTimeout(()=>publishPlayback(action!=="pause"),250);
  };
  const addVideo=async()=>{
    if(!party||!supabase||!member)return;const id=extractYouTubeId(videoUrl);if(!id){notify("That doesn't look like a valid YouTube URL.");return;}
    const pos=queue.length?Math.max(...queue.map(x=>x.position))+1:0;
    const {error}=await supabase.from("video_queue").insert({party_id:party.id,video_id:id,title:`YouTube video · ${id}`,added_by:member.username,position:pos});
    if(error){notify(error.message);return;}setVideoUrl("");notify("Added to the queue.");
    if(!party.current_video_id){await supabase.from("parties").update({current_video_id:id,playback_state:{playing:true,position:0,updated_at:new Date().toISOString()}}).eq("id",party.id);}
  };
  const sendChat=async()=>{
    if(!party||!member||!supabase||!chatText.trim())return;
    const body=chatText.trim();setChatText("");
    const {error}=await supabase.from("chat_messages").insert({party_id:party.id,user_id:member.user_id,username:member.username,body});
    if(error)notify(error.message);
  };
  const playNext=async()=>{
    if(!party||!supabase||!isHost||!queue.length)return;
    const next=queue[0];await supabase.from("parties").update({current_video_id:next.video_id,playback_state:{playing:true,position:0,updated_at:new Date().toISOString()}}).eq("id",party.id);
    await supabase.from("video_queue").delete().eq("id",next.id);
  };
  const invite=async()=>{
    const url=`${window.location.origin}/?party=${party?.code}`;try{await navigator.clipboard.writeText(url);setCopied(true);setTimeout(()=>setCopied(false),1800);}catch{notify(url);}
  };
  const leave=async()=>{
    if(member&&supabase)await supabase.from("party_members").update({online:false}).eq("id",member.id);
    setParty(null);setMember(null);setMessages([]);setQueue([]);setMembers([]);window.history.replaceState({},"", "/");
  };

  if(!party)return <main className={`landing theme-${theme}`}>
    <nav className="topbar"><a className="brand" href="#"><span className="brand-mark"><Radio size={19}/></span> vibe<span className="brand-dot">.</span></a><div className="nav-right"><span className="live-pill"><i/> REAL-TIME WATCH PARTIES</span><button className="icon-btn" onClick={()=>setTheme(theme==="dark"?"light":theme==="light"?"amoled":"dark")} title="Change theme">{theme==="light"?<Sun/>:<Moon/>}</button></div></nav>
    <section className="hero">
      <div className="hero-copy"><div className="eyebrow"><Sparkles size={14}/> YOUR PEOPLE. YOUR SCREEN. ONE MOMENT.</div><h1>Watch together.<br/><span>Feel closer.</span></h1><p className="hero-sub">The little moments hit different when everyone’s here. Start a room, drop the link, and press play.</p>
      <div className="hero-actions"><button className="primary-btn" onClick={createParty} disabled={busy}><Plus size={18}/>{busy?"Creating…":"Create a party"}</button><div className="join-inline"><input value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,"").slice(0,6))} placeholder="6-digit code" maxLength={6}/><button onClick={()=>joinByCode(code)} disabled={busy||code.length!==6}>Join <span>↗</span></button></div></div>
      <div className="name-field"><label>YOUR DISPLAY NAME</label><input value={name} onChange={e=>setName(e.target.value)} maxLength={24} placeholder="What should we call you?"/></div>
      <div className="trust-row"><span><Users size={15}/> No account needed</span><span><Radio size={15}/> Live sync</span><span><MessageCircle size={15}/> Built-in chat</span></div></div>
      <div className="hero-art"><div className="orb orb-one"/><div className="orb orb-two"/><div className="preview-window"><div className="preview-top"><div className="window-dots"><i/><i/><i/></div><span>FRIDAY NIGHT LOUNGE</span><span className="live-tag">● LIVE</span></div><div className="preview-screen"><div className="screen-glow"/><div className="play-circle"><Play fill="currentColor" size={24}/></div><div className="screen-caption">the best nights are shared.</div><div className="screen-bottom"><span>▶  12:48</span><span>HD · 4K</span></div></div><div className="preview-footer"><div className="avatar-stack"><b>J</b><b>M</b><b>A</b><b>+</b></div><span>4 friends watching</span><div className="sound-bars"><i/><i/><i/><i/><i/></div></div></div><div className="float-card float-left"><span className="float-emoji">😂</span><div><b>Jamie</b><small>is losing it rn</small></div></div><div className="float-card float-right"><span className="green-dot"/> <div><b>All synced up</b><small>0.2s difference</small></div></div></div>
    </section>
    <section className="feature-strip"><div><span>01</span><b>One shared screen</b><small>Stay perfectly in sync</small></div><div><span>02</span><b>Live conversation</b><small>Chat through every moment</small></div><div><span>03</span><b>Your room, your rules</b><small>Make it feel like yours</small></div></section>
    <footer><span>© 2026 VIBE</span><span>MADE FOR THE GROUP CHAT <span className="brand-dot">♥</span></span><span>YOUTUBE POWERED</span></footer>
    {notice&&<div className="toast">{notice}</div>}
  </main>;

  return <main className={`party-shell theme-${theme}`}>
    <header className="party-topbar"><a className="brand" href="#" onClick={e=>{e.preventDefault();leave()}}><span className="brand-mark"><Radio size={18}/></span> vibe<span className="brand-dot">.</span></a><div className="room-heading"><span className="live-pill"><i/> LIVE ROOM</span><b>{party.name}</b><small>#{party.code}</small></div><div className="top-actions"><button className="soft-btn" onClick={invite}>{copied?<Check size={16}/>:<Link2 size={16}/>} {copied?"Copied":"Invite friends"}</button><button className="icon-btn" onClick={()=>setTheme(theme==="dark"?"light":theme==="light"?"amoled":"dark")}><Settings2 size={18}/></button><button className="icon-btn" onClick={leave} title="Leave party"><LogOut size={18}/></button></div></header>
    <div className="party-content"><section className="watch-column"><div className="player-wrap"><div className="player-stage">{currentId?<div id="youtube-player" className="youtube-frame"/>:<div className="empty-player"><div className="empty-play"><Play size={28}/></div><h2>Your next shared moment starts here.</h2><p>Add a YouTube video to kick things off.</p><div className="add-video-inline"><input value={videoUrl} onChange={e=>setVideoUrl(e.target.value)} placeholder="Paste a YouTube link…"/><button onClick={addVideo}>Add video</button></div></div>}</div><div className="player-toolbar"><div className="toolbar-left"><span className="watching-dot"/><span>{members.length} watching</span><span className="toolbar-divider"/><span className="muted">Synced with host</span></div><div className="toolbar-right">{isHost&&<><button onClick={()=>hostControl("play")} title="Play"><Play size={16}/></button><button onClick={()=>hostControl("pause")} title="Pause"><Pause size={16}/></button><button onClick={playNext} title="Next video"><SkipForward size={16}/></button></>}<button onClick={()=>setChatOpen(!chatOpen)} title="Toggle chat"><MessageCircle size={16}/></button></div></div></div>
      <div className="below-player"><div><div className="section-kicker">UP NEXT</div><h2>The queue <span>{queue.length}</span></h2></div><div className="queue-add"><input value={videoUrl} onChange={e=>setVideoUrl(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addVideo()} placeholder="Paste a YouTube URL to add…"/><button onClick={addVideo}><Plus size={16}/> Add</button></div></div>
      <div className="queue-list">{queue.length?queue.map((item,i)=><div className="queue-item" key={item.id}><span className="queue-index">{String(i+1).padStart(2,"0")}</span><img src={videoThumb(item.video_id)} alt="Video thumbnail"/><div className="queue-info"><b>{item.title}</b><small>Added by {item.added_by}</small></div><button className="icon-btn small" onClick={async()=>{if(supabase)await supabase.from("parties").update({current_video_id:item.video_id,playback_state:{playing:true,position:0,updated_at:new Date().toISOString()}}).eq("id",party.id)}} title="Play this video"><Play size={15}/></button></div>):<div className="queue-empty">Your queue is clear. Add a video and let the good times roll ✨</div>}</div>
      </section>
      {chatOpen&&<aside className="side-panel"><div className="side-tabs"><button className={tab==="chat"?"active":""} onClick={()=>setTab("chat")}><MessageCircle size={15}/> Chat</button><button className={tab==="queue"?"active":""} onClick={()=>setTab("queue")}><ListVideo size={15}/> Queue</button><button className={tab==="people"?"active":""} onClick={()=>setTab("people")}><Users size={15}/> People <span className="tab-count">{members.length}</span></button></div>
      {tab==="chat"?<><div className="chat-header"><div><b>Room chat</b><small>Keep the commentary coming</small></div><span className="online-count"><i/> {members.length} online</span></div><div className="chat-messages">{messages.map(m=><div className="message" key={m.id}><div className="message-avatar">{m.username.slice(0,1).toUpperCase()}</div><div className="message-body"><div className="message-meta"><b>{m.username}</b><time>{new Date(m.created_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</time></div><p>{m.body}</p></div></div>)}<div ref={chatEnd}/></div><form className="chat-compose" onSubmit={e=>{e.preventDefault();sendChat()}}><input value={chatText} onChange={e=>setChatText(e.target.value)} placeholder="Say something…" maxLength={1000}/><button disabled={!chatText.trim()}><Send size={16}/></button></form></>:tab==="people"?<div className="people-list">{members.map(m=><div className="person" key={m.id}><div className="person-avatar">{m.username.slice(0,1).toUpperCase()}</div><div><b>{m.username}</b><small>{m.role==="host"?"Host":m.role==="moderator"?"Moderator":"Watching"}</small></div>{m.role==="host"&&<Crown size={15} className="host-crown"/>}</div>)}</div>:<div className="queue-list side-queue">{queue.map((item,i)=><div className="queue-item" key={item.id}><img src={videoThumb(item.video_id)} alt=""/><div className="queue-info"><b>{item.title}</b><small>Added by {item.added_by}</small></div></div>)}</div>}
      <div className="side-footer"><span><span className="green-dot"/> Connection active</span><span>VIBE ROOM</span></div></aside>}
    </div>{notice&&<div className="toast">{notice}</div>}
  </main>;
}