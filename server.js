require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(cors({ origin:"*", methods:["GET","POST","PUT","PATCH","DELETE","OPTIONS"], allowedHeaders:["Content-Type","Authorization"] }));
app.options("*", cors());
app.use(express.json());
app.use("/api", (req, res, next) => { res.setHeader("Content-Type","application/json"); next(); });

const supabase = createClient(process.env.SUPABASE_URL||"", process.env.SUPABASE_SERVICE_ROLE_KEY||"");
const JWT_SECRET = process.env.JWT_SECRET || "medicare_jwt_secret_2025";
const ADMIN_ID   = "admin@123";
const ADMIN_PASS = "9529007961";

// ══════════════════════════════════════════════════════════════════
// WHATSAPP — Twilio
// Env vars to add in Render:
//   TWILIO_ACCOUNT_SID    ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//   TWILIO_AUTH_TOKEN     your_token_here
//   TWILIO_WHATSAPP_FROM  whatsapp:+14155238886
//   ADMIN_WHATSAPP        919529007961   (your number, with country code, no +)
// ══════════════════════════════════════════════════════════════════

async function sendWhatsApp(toRaw, message) {
  const sid   = (process.env.TWILIO_ACCOUNT_SID  || "").trim();
  const token = (process.env.TWILIO_AUTH_TOKEN   || "").trim();
  const from  = (process.env.TWILIO_WHATSAPP_FROM|| "whatsapp:+14155238886").trim();

  if (!sid || !token || sid.length < 10) {
    console.log("ℹ️  WhatsApp skipped (Twilio not configured)");
    return { skipped: true };
  }
  // Clean & format number
  let num = String(toRaw).replace(/\D/g, "");
  if (num.length === 10) num = "91" + num;   // add India code
  const to = `whatsapp:+${num}`;

  const resp = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": "Basic " + Buffer.from(`${sid}:${token}`).toString("base64")
      },
      body: new URLSearchParams({ From: from, To: to, Body: message }).toString()
    }
  );
  const json = await resp.json();
  if (!resp.ok) { console.error("WhatsApp error:", json?.message); return { error: json?.message }; }
  console.log(`✅ WhatsApp → ${to} | SID: ${json.sid}`);
  return { sid: json.sid };
}

// ── Admin alert (every new booking) ───────────────────────────────
async function waAdminAlert(bk) {
  const adminNum = (process.env.ADMIN_WHATSAPP || "").replace(/\D/g,"");
  if (!adminNum) return;
  await sendWhatsApp(adminNum,
`🏥 *MediCare+ — New Booking!*

👤 *Patient:* ${bk.patient_name} (${bk.patient_age||"?"}y)
📧 ${bk.user_email}
📞 ${bk.phone || "No phone on file"}

🩺 *Doctor:* Dr. ${bk.doctor_name}
🏷️ ${bk.specialization}
📅 *Date:* ${bk.appointment_date}
⏰ *Time:* ${bk.appointment_time}

📋 *Problem:*
${bk.problem}

Login to confirm:
https://hospital-management-system-6exp.onrender.com

_MediCare+ HMS_`
  );
}

// ── Patient WhatsApp messages ─────────────────────────────────────
async function waPatient(phone, bk, type) {
  if (!phone) return;
  const msgs = {
    new:
`🏥 *MediCare+ Appointment Booked!*

Hi ${bk.patient_name}! 👋

Your appointment has been *received* ✅

🩺 *Doctor:* Dr. ${bk.doctor_name}
🏷️ ${bk.specialization}
📅 *Date:* ${bk.appointment_date}
⏰ *Time:* ${bk.appointment_time}

Status: ⏳ Pending confirmation

We will WhatsApp you once confirmed. 💚
_– MediCare+ Team_`,

    confirmed:
`✅ *Appointment CONFIRMED!*

Hi ${bk.patient_name}!

Your appointment is *officially confirmed* ✔️

🩺 *Dr. ${bk.doctor_name}*
📅 ${bk.appointment_date} at ${bk.appointment_time}
${bk.admin_notes ? "\n📝 *Note:* " + bk.admin_notes + "\n" : ""}
Please arrive 10 minutes early.
Bring any previous prescriptions.

_– MediCare+ Team_`,

    cancelled:
`❌ *Appointment Cancelled*

Hi ${bk.patient_name},

Your appointment with Dr. ${bk.doctor_name} has been *cancelled*.
${bk.admin_notes ? "\n📝 *Reason:* " + bk.admin_notes : ""}

Please book a new appointment.
_– MediCare+ Team_`,

    rescheduled:
`📅 *Appointment Rescheduled*

Hi ${bk.patient_name},

Your appointment has been *rescheduled* to:

🩺 *Dr. ${bk.doctor_name}*
📅 *New Date:* ${bk.appointment_date}
⏰ *New Time:* ${bk.appointment_time}
${bk.admin_notes ? "\n📝 " + bk.admin_notes : ""}
_– MediCare+ Team_`,

    completed:
`🎊 *Visit Complete — Thank You!*

Hi ${bk.patient_name},

Your visit with *Dr. ${bk.doctor_name}* is complete. 💚
${bk.admin_notes ? "\n📝 *Follow-up:* " + bk.admin_notes + "\n" : ""}
We hope you feel better soon!
Book a follow-up anytime.

_– MediCare+ Team_`
  };
  await sendWhatsApp(phone, msgs[type] || msgs.new);
}

// ══════════════════════════════════════════════════════════════════
// FREE NOTIFICATION METHODS (no Twilio needed)
// ══════════════════════════════════════════════════════════════════

// ── METHOD 1: EMAIL via Gmail SMTP (100% FREE) ────────────────────
// Env vars needed:
//   GMAIL_USER     your.gmail@gmail.com
//   GMAIL_PASS     your_app_password  (Google → Security → App Passwords)
//   ADMIN_EMAIL    admin@yourdomain.com  (where booking alerts go)
//
async function sendEmail(to, subject, htmlBody) {
  const user = (process.env.GMAIL_USER || "").trim();
  const pass = (process.env.GMAIL_PASS || "").trim();
  if (!user || !pass) { console.log("ℹ️  Email skipped (no Gmail creds)"); return { skipped: true }; }

  // Use Nodemailer via dynamic import (add "nodemailer" to package.json)
  let nodemailer;
  try { nodemailer = require("nodemailer"); }
  catch { console.log("ℹ️  nodemailer not installed. Run: npm install nodemailer"); return { skipped: true }; }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass }
  });
  try {
    const info = await transporter.sendMail({ from: `"MediCare+" <${user}>`, to, subject, html: htmlBody });
    console.log(`✅ Email sent to ${to}: ${info.messageId}`);
    return { messageId: info.messageId };
  } catch (e) {
    console.error("Email error:", e.message);
    return { error: e.message };
  }
}

async function emailBookingAlert(booking) {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.GMAIL_USER;
  if (!adminEmail) return;
  await sendEmail(
    adminEmail,
    `🏥 New Booking — ${booking.patient_name} → Dr. ${booking.doctor_name}`,
    `<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;border:1px solid #ddd;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#0B6E6E,#11B5B5);padding:20px 24px;color:#fff">
        <h2 style="margin:0;font-size:20px">🏥 MediCare+ New Booking</h2>
      </div>
      <div style="padding:24px">
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px 0;color:#666;font-size:13px;width:40%">Patient</td><td style="font-weight:700;font-size:14px">${booking.patient_name} (${booking.patient_age||"?"}y)</td></tr>
          <tr><td style="padding:8px 0;color:#666;font-size:13px">Email</td><td style="font-size:13px">${booking.user_email}</td></tr>
          <tr><td style="padding:8px 0;color:#666;font-size:13px">Phone</td><td style="font-size:13px">${booking.phone||"Not provided"}</td></tr>
          <tr><td style="padding:8px 0;color:#666;font-size:13px">Doctor</td><td style="font-weight:700;font-size:14px;color:#0B6E6E">Dr. ${booking.doctor_name}</td></tr>
          <tr><td style="padding:8px 0;color:#666;font-size:13px">Specialization</td><td style="font-size:13px">${booking.specialization}</td></tr>
          <tr><td style="padding:8px 0;color:#666;font-size:13px">Date</td><td style="font-weight:700;font-size:14px">${booking.appointment_date}</td></tr>
          <tr><td style="padding:8px 0;color:#666;font-size:13px">Time</td><td style="font-weight:700;font-size:14px">${booking.appointment_time}</td></tr>
          <tr><td style="padding:8px 0;color:#666;font-size:13px;vertical-align:top">Problem</td><td style="font-size:13px;line-height:1.6">${booking.problem}</td></tr>
        </table>
        <div style="margin-top:20px;text-align:center">
          <a href="https://hospital-management-system-6exp.onrender.com" style="background:#0B6E6E;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;display:inline-block">
            Open Admin Panel →
          </a>
        </div>
      </div>
      <div style="background:#f5f5f5;padding:12px 24px;text-align:center;font-size:11px;color:#999">MediCare+ HMS · Automated notification</div>
    </div>`
  );
}

async function emailPatientConfirmation(patientEmail, booking, status = "new") {
  if (!patientEmail) return;
  const subjects = {
    new:         `🏥 Appointment Received — Dr. ${booking.doctor_name} on ${booking.appointment_date}`,
    confirmed:   `✅ Appointment CONFIRMED — Dr. ${booking.doctor_name} on ${booking.appointment_date}`,
    cancelled:   `❌ Appointment Cancelled — MediCare+`,
    rescheduled: `📅 Appointment Rescheduled — New date: ${booking.appointment_date}`,
    completed:   `🎊 Visit Complete — Thank you, ${booking.patient_name}!`
  };
  const colors = { new:"#0B6E6E", confirmed:"#16a34a", cancelled:"#dc2626", rescheduled:"#2563eb", completed:"#7c3aed" };
  const icons  = { new:"🏥", confirmed:"✅", cancelled:"❌", rescheduled:"📅", completed:"🎊" };
  const bodies = {
    new: `Your appointment with <strong>Dr. ${booking.doctor_name}</strong> (${booking.specialization}) on <strong>${booking.appointment_date} at ${booking.appointment_time}</strong> has been received. Awaiting confirmation.`,
    confirmed: `Great news! Your appointment is <strong>officially confirmed</strong>.<br><br>📅 <strong>${booking.appointment_date}</strong> at <strong>${booking.appointment_time}</strong><br>🩺 <strong>Dr. ${booking.doctor_name}</strong><br><br>${booking.admin_notes?`📝 <em>${booking.admin_notes}</em><br><br>`:""}Please arrive 10 minutes early and bring any previous prescriptions.`,
    cancelled: `Your appointment with Dr. ${booking.doctor_name} has been cancelled.${booking.admin_notes?`<br><br>📝 <strong>Reason:</strong> ${booking.admin_notes}`:""}`,
    rescheduled: `Your appointment has been rescheduled to <strong>${booking.appointment_date} at ${booking.appointment_time}</strong>.${booking.admin_notes?`<br><br>📝 ${booking.admin_notes}`:""}`,
    completed: `Your visit with Dr. ${booking.doctor_name} is complete. We hope you're feeling better! 💚${booking.admin_notes?`<br><br>📝 <strong>Follow-up:</strong> ${booking.admin_notes}`:""}`
  };
  await sendEmail(
    patientEmail,
    subjects[status] || subjects.new,
    `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;border:1px solid #ddd;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(135deg,${colors[status]||"#0B6E6E"},${colors[status]||"#11B5B5"});padding:20px 24px;color:#fff">
        <div style="font-size:32px;margin-bottom:8px">${icons[status]||"🏥"}</div>
        <h2 style="margin:0;font-size:18px">MediCare+</h2>
        <p style="margin:4px 0 0;opacity:.85;font-size:13px">${subjects[status]||subjects.new}</p>
      </div>
      <div style="padding:24px;font-size:14px;line-height:1.8;color:#333">
        Hi <strong>${booking.patient_name}</strong>,<br><br>
        ${bodies[status] || bodies.new}
      </div>
      <div style="background:#f5f5f5;padding:12px 24px;text-align:center;font-size:11px;color:#999">
        MediCare+ Hospital Management System · Do not reply to this email
      </div>
    </div>`
  );
}

// ── METHOD 2: TELEGRAM BOT (100% FREE, unlimited) ─────────────────
// Env vars needed:
//   TELEGRAM_BOT_TOKEN   123456789:ABCdefGHIjklMNOpqrSTUvwxyz  (from @BotFather)
//   TELEGRAM_CHAT_ID     -100xxxxxxxxxx  (your group/channel ID)
//
async function sendTelegram(message) {
  const token   = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
  const chat_id = (process.env.TELEGRAM_CHAT_ID   || "").trim();
  if (!token || !chat_id) { console.log("ℹ️  Telegram skipped (no creds)"); return { skipped: true }; }
  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, text: message, parse_mode: "Markdown" })
  });
  const json = await resp.json();
  if (!json.ok) { console.error("Telegram error:", json.description); return { error: json.description }; }
  console.log(`✅ Telegram sent: ${json.result?.message_id}`);
  return { message_id: json.result?.message_id };
}

async function telegramBookingAlert(booking) {
  await sendTelegram(
`🏥 *MediCare+ — New Booking!*

👤 *Patient:* ${booking.patient_name} (${booking.patient_age||"?"}y)
📧 ${booking.user_email}
📞 ${booking.phone || "No phone"}

🩺 *Doctor:* Dr. ${booking.doctor_name}
🏷️ ${booking.specialization}
📅 *Date:* ${booking.appointment_date} at ${booking.appointment_time}

📋 *Problem:* ${booking.problem}

[Open Admin Panel](https://hospital-management-system-6exp.onrender.com)`
  );
}

// ── Master alert function — tries all configured methods ──────────
async function sendAllAlerts(booking, type = "new_booking") {
  const tasks = [];

  // WhatsApp (Twilio) — if configured
  if (process.env.TWILIO_ACCOUNT_SID) {
    const adminNum = (process.env.ADMIN_WHATSAPP||"").replace(/\D/g,"");
    if (type === "new_booking") {
      if (adminNum) tasks.push(waAdminAlert(booking));
      if (booking.phone) tasks.push(waPatient(booking.phone, booking, "new"));
    }
  }

  // Email (Gmail) — if configured
  if (process.env.GMAIL_USER && process.env.GMAIL_PASS) {
    if (type === "new_booking") {
      tasks.push(emailBookingAlert(booking));
      if (booking.user_email) tasks.push(emailPatientConfirmation(booking.user_email, booking, "new"));
    }
  }

  // Telegram — if configured
  if (process.env.TELEGRAM_BOT_TOKEN && type === "new_booking") {
    tasks.push(telegramBookingAlert(booking));
  }

  if (tasks.length === 0) {
    console.log("ℹ️  No notification channels configured. Add env vars for WhatsApp/Email/Telegram.");
  }

  await Promise.allSettled(tasks);
}

// Status update alerts (patient only — WhatsApp + Email)
async function sendStatusAlerts(phone, email, booking, status) {
  const tasks = [];
  if (process.env.TWILIO_ACCOUNT_SID && phone)  tasks.push(waPatient(phone, booking, status));
  if (process.env.GMAIL_USER && process.env.GMAIL_PASS && email) tasks.push(emailPatientConfirmation(email, booking, status));
  await Promise.allSettled(tasks);
}

// ── Auth middleware ────────────────────────────────────────────────
const auth = (req, res, next) => {
  const t = req.headers.authorization?.split(" ")[1];
  if (!t) return res.status(401).json({ error:"No token" });
  try { req.user = jwt.verify(t, JWT_SECRET); next(); }
  catch { res.status(401).json({ error:"Invalid token" }); }
};
const adminAuth = (req,res,next) =>
  auth(req,res,()=> req.user.is_admin ? next() : res.status(403).json({error:"Admin only"}));

// ── Gemini ────────────────────────────────────────────────────────
async function getGeminiKey() {
  try {
    const {data} = await supabase.from("settings").select("value").eq("key","gemini_api_key").single();
    const db=(data?.value||"").trim(), env=(process.env.GEMINI_API_KEY||"").trim();
    return db.length>20?db:env.length>20?env:null;
  } catch { return (process.env.GEMINI_API_KEY||"").trim()||null; }
}
async function callGemini(key, prompt) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,{
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.7,maxOutputTokens:1500}})
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message||`Gemini ${r.status}`);
  const txt = j?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!txt) throw new Error("Empty Gemini response");
  return txt;
}

// ══ AUTH ══════════════════════════════════════════════════════════
app.post("/api/auth/register", async (req,res) => {
  try {
    const {name,email,password,phone,age,blood_group} = req.body;
    if (!name||!email||!password) return res.status(400).json({error:"Name, email, password required"});
    const {data:ex} = await supabase.from("users").select("id").eq("email",email).single();
    if (ex) return res.status(409).json({error:"Email already registered"});
    const hashed = await bcrypt.hash(password,10), id=uuidv4();
    const {error} = await supabase.from("users").insert({id,name,email,password:hashed,phone:phone||null,age:age?parseInt(age):null,blood_group:blood_group||null,is_admin:false,is_active:true});
    if (error) throw error;
    const token = jwt.sign({id,email,name,is_admin:false},JWT_SECRET,{expiresIn:"7d"});
    res.json({token,user:{id,name,email,phone,age,blood_group,is_admin:false}});
  } catch(e){res.status(500).json({error:e.message});}
});

app.post("/api/auth/login", async (req,res) => {
  try {
    const {email,password} = req.body;
    if (!email||!password) return res.status(400).json({error:"Email and password required"});
    if (email===ADMIN_ID&&password===ADMIN_PASS) {
      const token=jwt.sign({id:"admin",email:ADMIN_ID,name:"Administrator",is_admin:true},JWT_SECRET,{expiresIn:"7d"});
      return res.json({token,user:{id:"admin",name:"Administrator",email:ADMIN_ID,is_admin:true}});
    }
    const {data:user,error}=await supabase.from("users").select("*").eq("email",email).single();
    if (error||!user) return res.status(404).json({error:"User not found"});
    if (!await bcrypt.compare(password,user.password)) return res.status(401).json({error:"Incorrect password"});
    if (!user.is_active) return res.status(403).json({error:"Account blocked"});
    const token=jwt.sign({id:user.id,email:user.email,name:user.name,is_admin:user.is_admin},JWT_SECRET,{expiresIn:"7d"});
    const {password:_,...safe}=user;
    res.json({token,user:safe});
  } catch(e){res.status(500).json({error:e.message});}
});

app.get("/api/auth/me", auth, async (req,res) => {
  try {
    if (req.user.is_admin&&req.user.id==="admin") return res.json({id:"admin",name:"Administrator",email:ADMIN_ID,is_admin:true});
    const {data,error}=await supabase.from("users").select("*").eq("id",req.user.id).single();
    if (error||!data) return res.status(404).json({error:"Not found"});
    const {password:_,...safe}=data;
    res.json(safe);
  } catch(e){res.status(500).json({error:e.message});}
});

// ══ DOCTORS ═══════════════════════════════════════════════════════
app.get("/api/doctors", async (req,res) => {
  const {data,error}=await supabase.from("doctors").select("*").eq("is_active",true).order("name");
  if (error) return res.status(500).json({error:error.message}); res.json(data);
});
app.get("/api/admin/doctors", adminAuth, async (req,res) => {
  const {data,error}=await supabase.from("doctors").select("*").order("created_at",{ascending:false});
  if (error) return res.status(500).json({error:error.message}); res.json(data);
});
app.post("/api/admin/doctors", adminAuth, async (req,res) => {
  try {
    const {name,specialization,qualification,experience,email,phone,available_days,available_time_start,available_time_end,consultation_fee}=req.body;
    if (!name||!specialization) return res.status(400).json({error:"Name and specialization required"});
    const {data,error}=await supabase.from("doctors").insert({id:uuidv4(),name,specialization,qualification:qualification||null,experience:experience?parseInt(experience):0,email:email||null,phone:phone||null,available_days:available_days||["Monday","Tuesday","Wednesday","Thursday","Friday"],available_time_start:available_time_start||"09:00",available_time_end:available_time_end||"17:00",consultation_fee:consultation_fee?parseInt(consultation_fee):500,is_active:true,is_available_today:true}).select().single();
    if (error) throw error; res.json({message:"Doctor added",doctor:data});
  } catch(e){res.status(500).json({error:e.message});}
});
app.put("/api/admin/doctors/:id", adminAuth, async (req,res) => {
  const {error}=await supabase.from("doctors").update({...req.body,updated_at:new Date().toISOString()}).eq("id",req.params.id);
  if (error) return res.status(500).json({error:error.message}); res.json({message:"Doctor updated"});
});
app.delete("/api/admin/doctors/:id", adminAuth, async (req,res) => {
  const {error}=await supabase.from("doctors").update({is_active:false,updated_at:new Date().toISOString()}).eq("id",req.params.id);
  if (error) return res.status(500).json({error:error.message}); res.json({message:"Doctor deactivated"});
});
app.patch("/api/admin/doctors/:id/availability", adminAuth, async (req,res) => {
  const {is_available_today,available_days,available_time_start,available_time_end}=req.body;
  const {error}=await supabase.from("doctors").update({is_available_today,available_days,available_time_start,available_time_end,updated_at:new Date().toISOString()}).eq("id",req.params.id);
  if (error) return res.status(500).json({error:error.message}); res.json({message:"Updated"});
});

// ══ BOOKINGS ══════════════════════════════════════════════════════
app.post("/api/bookings", auth, async (req,res) => {
  try {
    const {doctor_id,doctor_name,specialization,patient_name,patient_age,problem,appointment_date,appointment_time}=req.body;
    if (!doctor_id||!problem||!appointment_date||!appointment_time) return res.status(400).json({error:"Missing required fields"});

    // Fetch patient phone for WhatsApp
    const {data:uRow}=await supabase.from("users").select("phone").eq("id",req.user.id).single();
    const phone=uRow?.phone||null;

    const {data,error}=await supabase.from("bookings").insert({
      id:uuidv4(),user_id:req.user.id,user_name:req.user.name,user_email:req.user.email,
      doctor_id,doctor_name:doctor_name||"",specialization:specialization||"",
      patient_name:patient_name||req.user.name,patient_age:patient_age?parseInt(patient_age):null,
      problem,appointment_date,appointment_time,status:"pending",admin_notes:null,ai_suggestion:null
    }).select().single();
    if (error) throw error;

    // In-app notification
    await supabase.from("notifications").insert({
      id:uuidv4(),user_id:req.user.id,title:"Appointment Submitted 🎉",
      message:`Your appointment with Dr. ${doctor_name} on ${appointment_date} at ${appointment_time} is received.`,
      type:"booking",is_read:false
    });

    // All notifications (WhatsApp + Email + Telegram — uses whatever is configured)
    const bkForWA = {...data, phone};
    sendAllAlerts(bkForWA, "new_booking").catch(()=>{});

    res.json({message:"Booking created",booking:data});
  } catch(e){res.status(500).json({error:e.message});}
});

app.get("/api/bookings", auth, async (req,res) => {
  const {data,error}=await supabase.from("bookings").select("*").eq("user_id",req.user.id).order("created_at",{ascending:false});
  if (error) return res.status(500).json({error:error.message}); res.json(data);
});
app.get("/api/admin/bookings", adminAuth, async (req,res) => {
  try {
    let q=supabase.from("bookings").select("*").order("created_at",{ascending:false});
    if (req.query.status&&req.query.status!=="all") q=q.eq("status",req.query.status);
    if (req.query.date) q=q.eq("appointment_date",req.query.date);
    const {data,error}=await q;
    if (error) throw error; res.json(data);
  } catch(e){res.status(500).json({error:e.message});}
});
app.patch("/api/admin/bookings/:id", adminAuth, async (req,res) => {
  try {
    const {id}=req.params;
    const {status,admin_notes,appointment_date,appointment_time}=req.body;
    const {data:bk}=await supabase.from("bookings").select("*").eq("id",id).single();
    if (!bk) return res.status(404).json({error:"Booking not found"});
    const upd={status,admin_notes:admin_notes||null,updated_at:new Date().toISOString()};
    if (appointment_date) upd.appointment_date=appointment_date;
    if (appointment_time) upd.appointment_time=appointment_time;
    const {error}=await supabase.from("bookings").update(upd).eq("id",id);
    if (error) throw error;
    const fd=appointment_date||bk.appointment_date, ft=appointment_time||bk.appointment_time;
    const msgMap={
      confirmed:`✅ Appointment with Dr. ${bk.doctor_name} CONFIRMED for ${fd} at ${ft}.`,
      cancelled:`❌ Appointment with Dr. ${bk.doctor_name} cancelled.${admin_notes?" Reason: "+admin_notes:""}`,
      completed:`🎊 Visit with Dr. ${bk.doctor_name} complete. Thank you!`,
      rescheduled:`📅 Appointment rescheduled to ${fd} at ${ft}.`
    };
    if (msgMap[status]) await supabase.from("notifications").insert({
      id:uuidv4(),user_id:bk.user_id,
      title:`Appointment ${status.charAt(0).toUpperCase()+status.slice(1)}`,
      message:msgMap[status],type:"appointment_update",is_read:false
    });
    // Notify patient via all channels on status change
    if (["confirmed","cancelled","rescheduled","completed"].includes(status)) {
      const {data:uRow}=await supabase.from("users").select("phone,email").eq("id",bk.user_id).single();
      const updBk={...bk,appointment_date:fd,appointment_time:ft,admin_notes:admin_notes||null};
      sendStatusAlerts(uRow?.phone, uRow?.email, updBk, status).catch(()=>{});
    }
    res.json({message:"Booking updated and patient notified"});
  } catch(e){res.status(500).json({error:e.message});}
});

// ══ USERS ════════════════════════════════════════════════════════
app.get("/api/admin/users", adminAuth, async (req,res) => {
  const {data,error}=await supabase.from("users").select("id,name,email,phone,age,blood_group,is_admin,is_active,created_at").order("created_at",{ascending:false});
  if (error) return res.status(500).json({error:error.message}); res.json(data);
});
app.patch("/api/admin/users/:id", adminAuth, async (req,res) => {
  const {error}=await supabase.from("users").update({is_active:req.body.is_active,updated_at:new Date().toISOString()}).eq("id",req.params.id);
  if (error) return res.status(500).json({error:error.message}); res.json({message:"User updated"});
});

// ══ NOTIFICATIONS ═════════════════════════════════════════════════
app.get("/api/notifications", auth, async (req,res) => {
  try {
    const q=req.user.is_admin
      ?supabase.from("notifications").select("*").order("created_at",{ascending:false}).limit(50)
      :supabase.from("notifications").select("*").or(`user_id.eq.${req.user.id},user_id.eq.all`).order("created_at",{ascending:false}).limit(30);
    const {data,error}=await q;
    if (error) throw error; res.json(data);
  } catch(e){res.status(500).json({error:e.message});}
});
app.patch("/api/notifications/:id/read", auth, async (req,res) => {
  const {error}=await supabase.from("notifications").update({is_read:true}).eq("id",req.params.id);
  if (error) return res.status(500).json({error:error.message}); res.json({message:"Marked read"});
});
app.post("/api/admin/notifications", adminAuth, async (req,res) => {
  try {
    const {user_id,title,message,type}=req.body;
    if (!title||!message) return res.status(400).json({error:"Title and message required"});
    const {error}=await supabase.from("notifications").insert({id:uuidv4(),user_id:user_id||"all",title,message,type:type||"announcement",is_read:false});
    if (error) throw error; res.json({message:"Sent"});
  } catch(e){res.status(500).json({error:e.message});}
});

// ══ AI ════════════════════════════════════════════════════════════
app.post("/api/ai/suggest", auth, async (req,res) => {
  try {
    const {problem,patient_age,patient_name}=req.body;
    if (!problem) return res.status(400).json({error:"Problem required"});
    const key=await getGeminiKey();
    if (!key) return res.status(503).json({error:"AI not configured. Add Gemini API key in Settings."});
    const prompt=`You are a compassionate health assistant at MediCare+ Hospital.\nPatient: ${patient_name||"Patient"}, Age: ${patient_age||"Unknown"}\nSymptoms: "${problem}"\n\nRULES: ONLY home remedies. NO medicines.\n\n**🏠 Home Remedies for Temporary Relief:**\n• (4-5 specific remedies)\n\n**🛁 Comfort Measures:**\n• (2-3 tips)\n\n**⚠️ Seek Emergency Help If:**\n• (2-3 warning signs)\n\n**💚 From MediCare+:**\n(One warm sentence)`;
    const suggestion=await callGemini(key,prompt);
    const {data:latest}=await supabase.from("bookings").select("id").eq("user_id",req.user.id).order("created_at",{ascending:false}).limit(1).single();
    if (latest) await supabase.from("bookings").update({ai_suggestion:suggestion}).eq("id",latest.id);
    res.json({suggestion});
  } catch(e){console.error("Gemini:",e.message);res.status(500).json({error:"AI error: "+e.message});}
});
app.post("/api/admin/test-gemini", adminAuth, async (req,res) => {
  try {
    const key=(req.body.api_key||"").trim()||await getGeminiKey();
    if (!key) return res.status(400).json({success:false,error:"No API key"});
    const result=await callGemini(key,"Say 'MediCare AI is working!' in one sentence.");
    res.json({success:true,message:"Key is valid!",response:result});
  } catch(e){res.status(400).json({success:false,error:e.message});}
});

// ── Test all notification channels (admin) ────────────────────────
app.post("/api/admin/test-whatsapp", adminAuth, async (req,res) => {
  try {
    const {phone, channel="whatsapp"}=req.body;
    if (channel==="email") {
      const {email}=req.body;
      if (!email) return res.status(400).json({error:"Email required"});
      const r=await sendEmail(email,"✅ MediCare+ Email Test","<p>This is a test email from MediCare+ HMS. Email notifications are working! 🎉</p>");
      if (r.skipped) return res.json({success:false,message:"Gmail not configured. Add GMAIL_USER and GMAIL_PASS to Render."});
      if (r.error)   return res.status(400).json({success:false,error:r.error});
      return res.json({success:true,message:"Test email sent to "+email});
    }
    if (channel==="telegram") {
      const r=await sendTelegram("✅ *MediCare+ Telegram Test*\n\nIf you see this, Telegram notifications are working! 🎉\n\n_– MediCare+ Admin_");
      if (r.skipped) return res.json({success:false,message:"Telegram not configured. Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID."});
      if (r.error)   return res.status(400).json({success:false,error:r.error});
      return res.json({success:true,message:"Test Telegram sent!"});
    }
    // Default: WhatsApp
    if (!phone) return res.status(400).json({error:"Phone required for WhatsApp test"});
    const result=await sendWhatsApp(phone,"✅ *MediCare+ WhatsApp Test*\n\nHello! If you see this, WhatsApp notifications are working. 🎉\n\n_– MediCare+ Admin_");
    if (result.skipped) return res.json({success:false,message:"Twilio not configured. Add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM."});
    if (result.error)   return res.status(400).json({success:false,error:result.error});
    res.json({success:true,message:"Test WhatsApp sent! SID: "+result.sid});
  } catch(e){res.status(500).json({success:false,error:e.message});}
});

// ══ SETTINGS ══════════════════════════════════════════════════════
app.get("/api/settings", adminAuth, async (req,res) => {
  try {
    const {data}=await supabase.from("settings").select("value").eq("key","gemini_api_key").single();
    const db=(data?.value||"").trim(), env=(process.env.GEMINI_API_KEY||"").trim();
    const act=db.length>20?db:env;
    const masked=act.length>20?act.substring(0,7)+"••••••••"+act.slice(-4):"";
    const tSid=(process.env.TWILIO_ACCOUNT_SID||"").trim();
    const tTok=(process.env.TWILIO_AUTH_TOKEN||"").trim();
    const tFrom=(process.env.TWILIO_WHATSAPP_FROM||"").trim();
    const aWA=(process.env.ADMIN_WHATSAPP||"").trim();
    const gUser=(process.env.GMAIL_USER||"").trim();
    const gPass=(process.env.GMAIL_PASS||"").trim();
    const tgToken=(process.env.TELEGRAM_BOT_TOKEN||"").trim();
    const tgChat=(process.env.TELEGRAM_CHAT_ID||"").trim();
    res.json({
      has_key:act.length>20, masked_key:masked,
      source:db.length>20?"database":env.length>20?"environment":"none",
      env_key_set:env.length>20,
      whatsapp:{
        configured:tSid.length>10&&tTok.length>10,
        from:tFrom||"Not set",
        admin_number:aWA?"91*****"+aWA.slice(-4):"Not set",
        sid_set:tSid.length>10,
        token_set:tTok.length>10,
        from_set:tFrom.length>5
      },
      email:{ configured:gUser.length>3&&gPass.length>3, user:gUser?gUser.split("@")[0]+"@***":"Not set" },
      telegram:{ configured:tgToken.length>10&&tgChat.length>3 }
    });
  } catch(e){res.status(500).json({error:e.message});}
});
app.put("/api/settings/gemini", adminAuth, async (req,res) => {
  try {
    const key=(req.body.api_key||"").trim();
    if (key.length<20) return res.status(400).json({error:"API key looks invalid"});
    const {error}=await supabase.from("settings").upsert({key:"gemini_api_key",value:key,updated_at:new Date().toISOString()},{onConflict:"key"});
    if (error) throw error; res.json({message:"API key saved"});
  } catch(e){res.status(500).json({error:e.message});}
});
app.get("/api/admin/stats", adminAuth, async (req,res) => {
  try {
    const [bkR,uR,dR]=await Promise.all([
      supabase.from("bookings").select("status,created_at"),
      supabase.from("users").select("id,created_at").eq("is_admin",false),
      supabase.from("doctors").select("id").eq("is_active",true)
    ]);
    const bk=bkR.data||[];
    const c=bk.reduce((a,b)=>{a[b.status]=(a[b.status]||0)+1;return a;},{});
    const now=new Date();
    const trend=Array.from({length:7},(_,i)=>{
      const d=new Date(now);d.setDate(d.getDate()-(6-i));
      const ds=d.toISOString().split("T")[0];
      return{date:d.toLocaleDateString("en-IN",{weekday:"short"}),count:bk.filter(b=>b.created_at?.startsWith(ds)).length};
    });
    res.json({total_bookings:bk.length,pending:c.pending||0,confirmed:c.confirmed||0,completed:c.completed||0,cancelled:c.cancelled||0,total_patients:(uR.data||[]).length,active_doctors:(dR.data||[]).length,trend});
  } catch(e){res.status(500).json({error:e.message});}
});

app.get("/health",(req,res)=>res.json({status:"ok",v:"3.1",whatsapp:!!(process.env.TWILIO_ACCOUNT_SID),time:new Date().toISOString()}));
app.get("/",(req,res)=>res.json({message:"MediCare+ HMS v3.1 ✅ WhatsApp ready"}));
app.use((req,res)=>res.status(404).json({error:`Not found: ${req.method} ${req.path}`}));
app.use((err,req,res,next)=>res.status(500).json({error:err.message}));

const PORT=process.env.PORT||3001;
app.listen(PORT,()=>{
  console.log(`🏥 MediCare+ HMS v3.1 on port ${PORT}`);
  console.log(`🔐 Admin: ${ADMIN_ID} / ${ADMIN_PASS}`);
  console.log(`📱 WhatsApp: ${process.env.TWILIO_ACCOUNT_SID?"✅ Ready":"⚠️  Not configured (add Twilio env vars)"}`);
});
