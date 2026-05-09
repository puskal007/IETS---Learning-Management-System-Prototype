const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../config/database');
const { auth, adminOnly } = require('../middleware/auth');

const router = express.Router();
router.use(auth, adminOnly);

// ── STUDENTS ──
router.get('/students', async (req, res) => {
  try {
    const { search = '', limit = 100, offset = 0 } = req.query;
    const like = `%${search}%`;
    const students = await query(`
      SELECT u.id as user_id, u.name, u.email, u.phone, u.status,
             s.id as student_id, s.roll_number, s.semester, s.batch, s.section, s.gpa,
             COUNT(DISTINCT e.id) as enrolled_courses
      FROM students s
      JOIN users u ON s.user_id = u.id
      LEFT JOIN enrollments e ON e.student_id = s.id AND e.status = 'active'
      WHERE (u.name LIKE ? OR u.email LIKE ? OR s.roll_number LIKE ?)
      GROUP BY s.id, u.id, u.name, u.email, u.phone, u.status,
               s.roll_number, s.semester, s.batch, s.section, s.gpa
      ORDER BY u.name
      LIMIT ? OFFSET ?
    `, [like, like, like, parseInt(limit), parseInt(offset)]);
    const total = await query(
      `SELECT COUNT(*) as c FROM students s JOIN users u ON s.user_id=u.id
       WHERE u.name LIKE ? OR u.email LIKE ? OR s.roll_number LIKE ?`,
      [like, like, like]
    );
    res.json({ success: true, data: students, total: total[0].c });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/students', async (req, res) => {
  try {
    const { name, email, password = 'Student@123', phone, semester = 1, batch, section } = req.body;
    if (!name || !email) return res.status(400).json({ success: false, message: 'Name and email required' });
    const existing = await query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length) return res.status(409).json({ success: false, message: 'Email already exists' });
    const hashed = await bcrypt.hash(password, 12);
    const result = await query(
      'INSERT INTO users (name, email, password, phone, role, status, is_verified) VALUES (?, ?, ?, ?, "student", "active", 1)',
      [name, email.toLowerCase(), hashed, phone || null]
    );
    const uid = result.insertId;
    const roll = `IEG${String(uid).padStart(5, '0')}`;
    await query('INSERT INTO students (user_id, roll_number, semester, batch, section) VALUES (?, ?, ?, ?, ?)',
      [uid, roll, semester, batch || null, section || null]);
    res.status(201).json({ success: true, message: 'Student created', roll_number: roll });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.put('/students/:id', async (req, res) => {
  try {
    const { name, email, phone, semester, status, batch, section } = req.body;
    const s = await query('SELECT user_id FROM students WHERE id = ?', [req.params.id]);
    if (!s[0]) return res.status(404).json({ success: false, message: 'Student not found' });
    await query('UPDATE users SET name=?, email=?, phone=?, status=?, updated_at=NOW() WHERE id=?',
      [name, email, phone || null, status || 'active', s[0].user_id]);
    await query('UPDATE students SET semester=?, batch=?, section=? WHERE id=?',
      [semester || 1, batch || null, section || null, req.params.id]);
    res.json({ success: true, message: 'Student updated' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.delete('/students/:id', async (req, res) => {
  try {
    const s = await query('SELECT user_id FROM students WHERE id = ?', [req.params.id]);
    if (!s[0]) return res.status(404).json({ success: false, message: 'Student not found' });
    await query('DELETE FROM users WHERE id = ?', [s[0].user_id]);
    res.json({ success: true, message: 'Student deleted' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/students/:id/enroll', async (req, res) => {
  try {
    const { course_id } = req.body;
    if (!course_id) return res.status(400).json({ success: false, message: 'course_id required' });
    await query('INSERT IGNORE INTO enrollments (student_id, course_id) VALUES (?, ?)', [req.params.id, course_id]);
    await query(
      'UPDATE courses SET current_enrollment = (SELECT COUNT(*) FROM enrollments WHERE course_id=? AND status="active") WHERE id=?',
      [course_id, course_id]
    );
    res.json({ success: true, message: 'Student enrolled' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ── TEACHERS ──
router.get('/teachers', async (req, res) => {
  try {
    const teachers = await query(`
      SELECT u.id as user_id, u.name, u.email, u.phone, u.status,
             t.id as teacher_id, t.department, t.specialization, t.employee_id,
             COUNT(DISTINCT tc.course_id) as assigned_courses
      FROM teachers t
      JOIN users u ON t.user_id = u.id
      LEFT JOIN teacher_courses tc ON t.id = tc.teacher_id
      GROUP BY t.id, u.id, u.name, u.email, u.phone, u.status,
               t.department, t.specialization, t.employee_id
      ORDER BY u.name
    `);
    res.json({ success: true, data: teachers });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/teachers', async (req, res) => {
  try {
    const { name, email, password = 'Teacher@123', phone, department, specialization } = req.body;
    if (!name || !email) return res.status(400).json({ success: false, message: 'Name and email required' });
    const existing = await query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length) return res.status(409).json({ success: false, message: 'Email already exists' });
    const hashed = await bcrypt.hash(password, 12);
    const result = await query(
      'INSERT INTO users (name, email, password, phone, role, status, is_verified) VALUES (?, ?, ?, ?, "teacher", "active", 1)',
      [name, email.toLowerCase(), hashed, phone || null]
    );
    const uid = result.insertId;
    const empId = `TCH${String(uid).padStart(4, '0')}`;
    await query('INSERT INTO teachers (user_id, employee_id, department, specialization) VALUES (?, ?, ?, ?)',
      [uid, empId, department || null, specialization || null]);
    res.status(201).json({ success: true, message: 'Teacher created', employee_id: empId });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.put('/teachers/:id', async (req, res) => {
  try {
    const { name, email, phone, department, specialization, status } = req.body;
    const t = await query('SELECT user_id FROM teachers WHERE id = ?', [req.params.id]);
    if (!t[0]) return res.status(404).json({ success: false, message: 'Teacher not found' });
    await query('UPDATE users SET name=?, email=?, phone=?, status=?, updated_at=NOW() WHERE id=?',
      [name, email, phone || null, status || 'active', t[0].user_id]);
    await query('UPDATE teachers SET department=?, specialization=? WHERE id=?',
      [department || null, specialization || null, req.params.id]);
    res.json({ success: true, message: 'Teacher updated' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.delete('/teachers/:id', async (req, res) => {
  try {
    const t = await query('SELECT user_id FROM teachers WHERE id = ?', [req.params.id]);
    if (!t[0]) return res.status(404).json({ success: false, message: 'Teacher not found' });
    await query('DELETE FROM users WHERE id = ?', [t[0].user_id]);
    res.json({ success: true, message: 'Teacher deleted' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/teachers/:id/assign-course', async (req, res) => {
  try {
    const { course_id } = req.body;
    if (!course_id) return res.status(400).json({ success: false, message: 'course_id required' });
    await query('INSERT IGNORE INTO teacher_courses (teacher_id, course_id) VALUES (?, ?)', [req.params.id, course_id]);
    const t = await query(
      'SELECT u.name, u.email FROM teachers tc JOIN users u ON tc.user_id=u.id WHERE tc.id=?',
      [req.params.id]
    );
    if (t[0]) await query(
      'UPDATE courses SET instructor_id=?, instructor_name=?, instructor_email=? WHERE id=?',
      [req.params.id, t[0].name, t[0].email, course_id]
    );
    res.json({ success: true, message: 'Course assigned to teacher' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.delete('/teachers/:id/assign-course/:courseId', async (req, res) => {
  try {
    await query('DELETE FROM teacher_courses WHERE teacher_id=? AND course_id=?', [req.params.id, req.params.courseId]);
    res.json({ success: true, message: 'Course unassigned from teacher' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ── COURSES ──
router.get('/courses', async (req, res) => {
  try {
    const courses = await query(`
      SELECT c.id, c.name, c.code, c.description, c.credits, c.semester,
             c.department, c.instructor_name, c.instructor_email, c.instructor_phone,
             c.max_students, c.current_enrollment, c.status, c.start_date, c.end_date,
             c.created_at, c.updated_at,
             COUNT(DISTINCT e.id) as enrolled_count,
             COUNT(DISTINCT a.id) as assignment_count,
             MAX(t.id) as teacher_id,
             MAX(u.name) as teacher_name
      FROM courses c
      LEFT JOIN enrollments e ON c.id = e.course_id AND e.status = 'active'
      LEFT JOIN assignments a ON c.id = a.course_id
      LEFT JOIN teacher_courses tc ON c.id = tc.course_id
      LEFT JOIN teachers t ON tc.teacher_id = t.id
      LEFT JOIN users u ON t.user_id = u.id
      GROUP BY c.id, c.name, c.code, c.description, c.credits, c.semester,
               c.department, c.instructor_name, c.instructor_email, c.instructor_phone,
               c.max_students, c.current_enrollment, c.status, c.start_date, c.end_date,
               c.created_at, c.updated_at
      ORDER BY c.semester, c.code
    `);
    res.json({ success: true, data: courses });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/courses', async (req, res) => {
  try {
    const { name, code, description, credits = 3, semester = 1, department,
      instructor_name, instructor_email, instructor_phone, max_students = 60, start_date, end_date } = req.body;
    if (!name || !code) return res.status(400).json({ success: false, message: 'Name and code required' });
    await query(
      'INSERT INTO courses (name, code, description, credits, semester, department, instructor_name, instructor_email, instructor_phone, max_students, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, code, description || null, credits, semester, department || null,
        instructor_name || null, instructor_email || null, instructor_phone || null,
        max_students, start_date || null, end_date || null]
    );
    res.status(201).json({ success: true, message: 'Course created' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.put('/courses/:id', async (req, res) => {
  try {
    const { name, code, description, credits, semester, department,
      instructor_name, instructor_email, max_students, status } = req.body;
    await query(
      'UPDATE courses SET name=?, code=?, description=?, credits=?, semester=?, department=?, instructor_name=?, instructor_email=?, max_students=?, status=?, updated_at=NOW() WHERE id=?',
      [name, code, description || null, credits || 3, semester || 1, department || null,
        instructor_name || null, instructor_email || null, max_students || 60, status || 'active', req.params.id]
    );
    res.json({ success: true, message: 'Course updated' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

router.delete('/courses/:id', async (req, res) => {
  try {
    await query('UPDATE courses SET status = "archived" WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Course archived' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ── STATS ──
router.get('/stats', async (req, res) => {
  try {
    const [students, teachers, courses, assignments, enrollments,
      recentStudents, recentCourses, topCourses] = await Promise.all([
      query('SELECT COUNT(*) as c FROM students s JOIN users u ON s.user_id=u.id WHERE u.status="active"'),
      query('SELECT COUNT(*) as c FROM teachers t JOIN users u ON t.user_id=u.id WHERE u.status="active"'),
      query('SELECT COUNT(*) as c FROM courses WHERE status="active"'),
      query('SELECT COUNT(*) as c FROM assignments WHERE status="published"'),
      query('SELECT COUNT(*) as c FROM enrollments WHERE status="active"'),
      query(`SELECT u.name, u.email, u.created_at, s.roll_number
             FROM students s JOIN users u ON s.user_id=u.id
             ORDER BY u.created_at DESC LIMIT 5`),
      query(`SELECT c.id, c.code, c.name, c.instructor_name, c.credits, c.semester,
             COUNT(e.id) as enrolled
             FROM courses c
             LEFT JOIN enrollments e ON c.id=e.course_id AND e.status="active"
             WHERE c.status="active"
             GROUP BY c.id, c.code, c.name, c.instructor_name, c.credits, c.semester
             ORDER BY c.id DESC LIMIT 5`),
      query(`SELECT c.id, c.code, c.name, COUNT(e.id) as enrolled
             FROM courses c
             JOIN enrollments e ON c.id=e.course_id AND e.status="active"
             GROUP BY c.id, c.code, c.name
             ORDER BY enrolled DESC LIMIT 5`),
    ]);
    res.json({
      success: true,
      data: {
        stats: {
          students: students[0].c, teachers: teachers[0].c,
          courses: courses[0].c, assignments: assignments[0].c,
          enrollments: enrollments[0].c
        },
        recent_students: recentStudents,
        recent_courses: recentCourses,
        top_courses: topCourses
      }
    });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ── GRADE ──
router.post('/grade', async (req, res) => {
  try {
    const { student_id, course_id, assignment_id, score, max_score = 100, feedback } = req.body;
    const pct = Math.round((score / max_score) * 100);
    const letter = pct >= 90 ? 'A' : pct >= 80 ? 'B' : pct >= 70 ? 'C' : pct >= 60 ? 'D' : 'F';
    await query(`
      INSERT INTO grades (student_id, course_id, assignment_id, score, max_score, percentage, letter_grade, feedback, graded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE score=VALUES(score), percentage=VALUES(percentage),
      letter_grade=VALUES(letter_grade), feedback=VALUES(feedback), graded_at=NOW()
    `, [student_id, course_id, assignment_id || null, score, max_score, pct, letter, feedback || null]);
    const grades = await query('SELECT percentage FROM grades WHERE student_id=?', [student_id]);
    if (grades.length) {
      const avg = grades.reduce((a, g) => a + g.percentage, 0) / grades.length;
      const gpa = avg >= 90 ? 4.0 : avg >= 80 ? 3.0 : avg >= 70 ? 2.0 : avg >= 60 ? 1.0 : 0.0;
      await query('UPDATE students SET gpa=? WHERE id=?', [gpa.toFixed(2), student_id]);
    }
    res.json({ success: true, message: 'Grade saved', letter_grade: letter, percentage: pct });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

module.exports = router;