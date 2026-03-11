const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'https://your-vercel-domain.vercel.app'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Initialize Google Generative AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// ==================== UTILITY FUNCTIONS ====================
const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

// ==================== AUTHENTICATION ROUTES ====================
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name, userType } = req.body;
    
    const { data, error } = await supabase.auth.signUpWithPassword({
      email,
      password,
    });

    if (error) return res.status(400).json({ error: error.message });

    // Store user profile
    const { error: profileError } = await supabase
      .from('users')
      .insert([{
        id: data.user.id,
        email,
        name,
        user_type: userType,
        created_at: new Date()
      }]);

    res.json({ success: true, user: data.user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) return res.status(400).json({ error: error.message });

    res.json({ success: true, user: data.user, session: data.session });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== PATIENT ROUTES ====================
app.get('/api/patients', async (req, res) => {
  try {
    const { data, error } = await supabase.from('patients').select('*');
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/patients', async (req, res) => {
  try {
    const { name, email, phone, age, gender, medicalHistory } = req.body;
    
    const { data, error } = await supabase
      .from('patients')
      .insert([{
        id: generateUUID(),
        name,
        email,
        phone,
        age,
        gender,
        medical_history: medicalHistory,
        created_at: new Date()
      }])
      .select();

    if (error) throw error;
    res.json({ success: true, patient: data[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/patients/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('patients')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== APPOINTMENT ROUTES ====================
app.get('/api/appointments', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('appointments')
      .select('*, patients(name, email), doctors(name, specialization)')
      .order('appointment_date', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/appointments', async (req, res) => {
  try {
    const { patientId, doctorId, appointmentDate, reason, notes } = req.body;
    
    const { data, error } = await supabase
      .from('appointments')
      .insert([{
        id: generateUUID(),
        patient_id: patientId,
        doctor_id: doctorId,
        appointment_date: appointmentDate,
        reason,
        notes,
        status: 'scheduled',
        created_at: new Date()
      }])
      .select();

    if (error) throw error;
    res.json({ success: true, appointment: data[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/appointments/:id', async (req, res) => {
  try {
    const { status } = req.body;
    
    const { data, error } = await supabase
      .from('appointments')
      .update({ status })
      .eq('id', req.params.id)
      .select();

    if (error) throw error;
    res.json({ success: true, appointment: data[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== PRESCRIPTION ROUTES ====================
app.get('/api/prescriptions/:patientId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('prescriptions')
      .select('*')
      .eq('patient_id', req.params.patientId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/prescriptions', async (req, res) => {
  try {
    const { patientId, doctorId, medications, instructions, dosage } = req.body;
    
    const { data, error } = await supabase
      .from('prescriptions')
      .insert([{
        id: generateUUID(),
        patient_id: patientId,
        doctor_id: doctorId,
        medications,
        instructions,
        dosage,
        created_at: new Date()
      }])
      .select();

    if (error) throw error;
    res.json({ success: true, prescription: data[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== DOCTOR ROUTES ====================
app.get('/api/doctors', async (req, res) => {
  try {
    const { data, error } = await supabase.from('doctors').select('*');
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/doctors', async (req, res) => {
  try {
    const { name, email, phone, specialization, licenseNumber } = req.body;
    
    const { data, error } = await supabase
      .from('doctors')
      .insert([{
        id: generateUUID(),
        name,
        email,
        phone,
        specialization,
        license_number: licenseNumber,
        created_at: new Date()
      }])
      .select();

    if (error) throw error;
    res.json({ success: true, doctor: data[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== AI DIAGNOSIS ASSISTANT ====================
app.post('/api/chat', async (req, res) => {
  try {
    const { message, patientData } = req.body;

    const systemPrompt = `You are a helpful hospital medical assistant. You help patients understand their symptoms and conditions. 
    IMPORTANT: You are NOT a replacement for real doctors. Always recommend consulting with a healthcare professional for proper diagnosis and treatment.
    
    Patient Information:
    - Age: ${patientData?.age || 'Not provided'}
    - Gender: ${patientData?.gender || 'Not provided'}
    - Medical History: ${patientData?.medicalHistory || 'Not provided'}
    
    Provide helpful, empathetic responses based on the patient's input. When discussing symptoms, always remind them to consult with a doctor.`;

    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: message }] }],
      systemInstruction: systemPrompt,
    });

    const response = result.response.text();
    
    res.json({ 
      success: true, 
      response,
      timestamp: new Date()
    });
  } catch (err) {
    console.error('AI Chat Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== MEDICAL RECORD ROUTES ====================
app.get('/api/medical-records/:patientId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('medical_records')
      .select('*')
      .eq('patient_id', req.params.patientId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/medical-records', async (req, res) => {
  try {
    const { patientId, recordType, description, findings } = req.body;
    
    const { data, error } = await supabase
      .from('medical_records')
      .insert([{
        id: generateUUID(),
        patient_id: patientId,
        record_type: recordType,
        description,
        findings,
        created_at: new Date()
      }])
      .select();

    if (error) throw error;
    res.json({ success: true, record: data[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== NOTIFICATIONS ROUTES ====================
app.get('/api/notifications/:userId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', req.params.userId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/notifications/unread/:userId', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', req.params.userId)
      .eq('read', false);

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/notifications', async (req, res) => {
  try {
    const { userId, patientId, appointmentId, type, title, message } = req.body;
    
    const { data, error } = await supabase
      .from('notifications')
      .insert([{
        id: generateUUID(),
        user_id: userId,
        patient_id: patientId,
        appointment_id: appointmentId,
        type,
        title,
        message,
        created_at: new Date()
      }])
      .select();

    if (error) throw error;
    res.json({ success: true, notification: data[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/notifications/:id/read', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('notifications')
      .update({ read: true, read_at: new Date() })
      .eq('id', req.params.id)
      .select();

    if (error) throw error;
    res.json({ success: true, notification: data[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/notifications/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('notifications')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== ADMIN APPOINTMENT CONFIRMATION ROUTES ====================
app.get('/api/admin/appointments-pending', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('appointments')
      .select(`
        *,
        patients(name, email, phone),
        doctors(name, specialization, email),
        appointment_confirmations(*)
      `)
      .order('appointment_date', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/confirm-appointment', async (req, res) => {
  try {
    const { appointmentId, doctorId, adminNotes, suggestedDate } = req.body;

    // Create confirmation record
    const { data: confirmData, error: confirmError } = await supabase
      .from('appointment_confirmations')
      .insert([{
        id: generateUUID(),
        appointment_id: appointmentId,
        confirmed_by: doctorId,
        confirmation_date: new Date(),
        admin_notes: adminNotes,
        suggested_date: suggestedDate || null,
        status: suggestedDate ? 'suggested' : 'confirmed',
        created_at: new Date()
      }])
      .select();

    if (confirmError) throw confirmError;

    // Update appointment status
    const { data: aptData, error: aptError } = await supabase
      .from('appointments')
      .update({ status: suggestedDate ? 'rescheduled' : 'confirmed' })
      .eq('id', appointmentId)
      .select();

    if (aptError) throw aptError;

    // Get appointment and patient details for notification
    const apt = aptData[0];
    
    // Create notification for patient
    const notificationMessage = suggestedDate 
      ? `Your appointment has been suggested for ${new Date(suggestedDate).toLocaleString()}. Please confirm.`
      : `Your appointment on ${new Date(apt.appointment_date).toLocaleString()} has been confirmed!`;

    const notificationTitle = suggestedDate 
      ? 'Appointment Suggestion'
      : 'Appointment Confirmed!';

    await supabase
      .from('notifications')
      .insert([{
        id: generateUUID(),
        user_id: apt.patient_id,
        patient_id: apt.patient_id,
        appointment_id: appointmentId,
        type: suggestedDate ? 'appointment_reminder' : 'appointment_confirmed',
        title: notificationTitle,
        message: notificationMessage,
        created_at: new Date()
      }]);

    res.json({ success: true, confirmation: confirmData[0], appointment: aptData[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/admin/reject-appointment/:id', async (req, res) => {
  try {
    const { reason } = req.body;

    // Update confirmation
    const { data: confirmData, error: confirmError } = await supabase
      .from('appointment_confirmations')
      .update({ status: 'rejected' })
      .eq('appointment_id', req.params.id)
      .select();

    if (confirmError) throw confirmError;

    // Update appointment
    const { data: aptData, error: aptError } = await supabase
      .from('appointments')
      .update({ status: 'cancelled' })
      .eq('id', req.params.id)
      .select();

    if (aptError) throw aptError;

    // Create notification
    const apt = aptData[0];
    await supabase
      .from('notifications')
      .insert([{
        id: generateUUID(),
        user_id: apt.patient_id,
        patient_id: apt.patient_id,
        appointment_id: req.params.id,
        type: 'appointment_cancelled',
        title: 'Appointment Cancelled',
        message: `Your appointment has been cancelled. Reason: ${reason || 'Not specified'}`,
        created_at: new Date()
      }]);

    res.json({ success: true, confirmation: confirmData[0], appointment: aptData[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== ANALYTICS ROUTES ====================
app.get('/api/analytics/dashboard', async (req, res) => {
  try {
    const [patientsCount, appointmentsCount, doctorsCount] = await Promise.all([
      supabase.from('patients').select('*', { count: 'exact', head: true }),
      supabase.from('appointments').select('*', { count: 'exact', head: true }),
      supabase.from('doctors').select('*', { count: 'exact', head: true })
    ]);

    res.json({
      totalPatients: patientsCount.count,
      totalAppointments: appointmentsCount.count,
      totalDoctors: doctorsCount.count,
      timestamp: new Date()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => {
  res.json({ status: 'Hospital Management System is running', timestamp: new Date() });
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
  console.log(`🏥 Hospital Management System Backend running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Google AI: ${process.env.GOOGLE_API_KEY ? '✓ Configured' : '✗ Missing'}`);
  console.log(`Supabase: ${process.env.SUPABASE_URL ? '✓ Configured' : '✗ Missing'}`);
});

module.exports = app;
