/* ═══════════════════════════════════════════════
   CVC Hire — now backed by MySQL via the PHP API
   (see apiClient.js for the `api` object this file calls)
   ═══════════════════════════════════════════════ */

let globalJobs    = [];
let applications  = [];
let savedJobs     = [];
let currentUser   = null;
let currentFilter = "all";
let searchKeyword = "";
let locationFilter= "";
let salarySort    = "default";
let appChart      = null;

/* ─── Toast ─────────────────────────────────────────────── */
function showToast(msg) {
    const t = document.getElementById("toastMsg");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove("show"), 2600);
}

function escHtml(str) {
    return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

/* ─── Job actions ───────────────────────────────────────── */
async function applyToJob(jobId, studentEmail, studentName) {
    try {
        await api.apply(jobId, studentEmail, studentName);
        showToast("🎉 Application submitted!");
        await renderStudentDashboard();
    } catch (err) {
        showToast(err.error || "Could not apply");
    }
    return true;
}

async function updateApplicationStatus(jobId, studentEmail, newStatus) {
    await api.updateStatus(jobId, studentEmail, newStatus);
    showToast(`Status updated to ${newStatus}`);
    await renderEmployerDashboard();
}

async function toggleSaveJob(jobId) {
    const { saved } = await api.toggleSave(jobId, currentUser.email);
    showToast(saved ? "⭐ Job saved!" : "Bookmark removed");
    await renderStudentDashboard();
}

async function deleteJob(jobId) {
    if (!confirm("Delete this job posting? This cannot be undone.")) return;
    await api.deleteJob(jobId);
    showToast("Job deleted");
    await renderEmployerDashboard();
}

async function editJobDetails(jobId, newDesc, newSalary) {
    await api.updateJob(jobId, newDesc, newSalary);
    showToast("✅ Job updated");
    await renderEmployerDashboard();
}

async function postNewJob() {
    const title    = document.getElementById("jobTitle")?.value.trim();
    const company  = document.getElementById("jobCompany")?.value.trim();
    const type     = document.getElementById("jobType")?.value;
    const location = document.getElementById("jobLocation")?.value.trim();
    const salary   = document.getElementById("jobSalary")?.value.trim();
    const desc     = document.getElementById("jobDesc")?.value.trim();

    if (!title || !company) { showToast("Title and company are required"); return; }

    try {
        await api.createJob({
            employerId: currentUser.employerId, title, company, type,
            location:    location || "Not specified",
            salary:      salary   || "Negotiable",
            description: desc     || "No description provided."
        });
        showToast("✅ Job posted!");
        ["jobTitle","jobCompany","jobLocation","jobSalary","jobDesc"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
        await renderEmployerDashboard();
    } catch (err) {
        showToast(err.error || "Could not post job");
    }
}

/* ─── Company Profile Modal (Employer) ─────────────────── */
async function openCompanyProfileModal() {
    const modal = document.getElementById("companyProfileModal");
    if (!modal) return;
    const cp = await api.getEmployerProfile(currentUser.email);
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ""; };
    set("cpCompanyName",  cp.company_name);
    set("cpIndustry",     cp.industry);
    set("cpWebsite",      cp.website);
    set("cpDescription",  cp.description);
    set("cpContactName",  cp.contact_name || currentUser.displayName);
    set("cpPhone",        cp.phone);
    set("cpAddress",      cp.address);
    modal.classList.add("open");
}

async function saveCompanyProfile() {
    const get = id => document.getElementById(id)?.value.trim() || "";
    const contactName = get("cpContactName");
    await api.saveEmployerProfile({
        email:        currentUser.email,
        companyName:  get("cpCompanyName"),
        industry:     get("cpIndustry"),
        website:      get("cpWebsite"),
        description:  get("cpDescription"),
        contactName,
        phone:        get("cpPhone"),
        address:      get("cpAddress")
    });
    if (contactName) {
        currentUser.displayName = contactName;
        sessionStorage.setItem("cvc_user", JSON.stringify(currentUser));
    }
    document.getElementById("companyProfileModal")?.classList.remove("open");
    showToast("✅ Company profile saved!");
    await renderEmployerDashboard();
}

/* ─── View Company Info (from Student side) ─────────────── */
async function viewCompanyInfo(employerId) {
    const modal = document.getElementById("companyInfoModal");
    if (!modal) return;
    let cp = {};
    try { cp = await api.getEmployerPublic(employerId); } catch (e) { /* ignore */ }
    const content = document.getElementById("companyInfoContent");
    if (content) {
        content.innerHTML = `
            <div class="applicant-profile-section">
                <div class="applicant-profile-header">
                    <div class="applicant-avatar-lg">🏢</div>
                    <div>
                        <div class="applicant-profile-name">${escHtml(cp.company_name || "Company")}</div>
                        <div class="applicant-profile-meta">${escHtml(cp.industry || "Industry not specified")}</div>
                    </div>
                </div>
                <div class="applicant-detail-grid">
                    <div class="applicant-detail-item"><strong>Contact Person</strong><span>${escHtml(cp.contact_name || "—")}</span></div>
                    <div class="applicant-detail-item"><strong>Phone</strong><span>${escHtml(cp.phone || "—")}</span></div>
                    <div class="applicant-detail-item"><strong>Address</strong><span>${escHtml(cp.address || "—")}</span></div>
                    <div class="applicant-detail-item"><strong>Website</strong><span>${cp.website ? `<a href="${escHtml(cp.website)}" target="_blank" style="color:var(--accent)">${escHtml(cp.website)}</a>` : "—"}</span></div>
                </div>
                ${cp.description ? `<div style="margin-top:10px;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);font-size:0.9rem;color:var(--text2);line-height:1.7;">${escHtml(cp.description)}</div>` : '<div class="empty-state" style="padding:1rem 0"><i class="fas fa-info-circle"></i>No company description yet.</div>'}
            </div>`;
    }
    modal.classList.add("open");
}

/* ─── View Applicant Profile (from Employer side) ──────── */
async function viewApplicantProfile(studentEmail) {
    const modal = document.getElementById("applicantDetailModal");
    if (!modal) return;
    const p = await api.getStudentProfile(studentEmail);
    const displayName = (p.last_name || p.first_name)
        ? `${p.last_name || ""} ${p.first_name || ""}`.trim()
        : (p.full_name || studentEmail);
    document.getElementById("applicantDetailName").textContent = displayName;
    const content = document.getElementById("applicantDetailContent");
    if (content) {
        content.innerHTML = `
            <div class="applicant-profile-section">
                <div class="applicant-profile-header">
                    <div class="applicant-avatar-lg">🎓</div>
                    <div>
                        <div class="applicant-profile-name">${escHtml(displayName)}</div>
                        <div class="applicant-profile-meta">${escHtml(p.course || "Course not specified")} · ${escHtml(p.school || "")}</div>
                    </div>
                </div>
                <div class="applicant-detail-grid">
                    <div class="applicant-detail-item"><strong>Last Name</strong><span>${escHtml(p.last_name || "—")}</span></div>
                    <div class="applicant-detail-item"><strong>First Name</strong><span>${escHtml(p.first_name || "—")}</span></div>
                    <div class="applicant-detail-item"><strong>Age</strong><span>${escHtml(p.age || "—")}</span></div>
                    <div class="applicant-detail-item"><strong>Birthdate</strong><span>${escHtml(p.birthdate || "—")}</span></div>
                    <div class="applicant-detail-item"><strong>Contact</strong><span>${escHtml(p.phone || "—")}</span></div>
                    <div class="applicant-detail-item"><strong>Address</strong><span>${escHtml(p.address || "—")}</span></div>
                </div>
                ${p.skills ? `<div style="margin-top:10px;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);"><strong style="font-size:0.72rem;color:var(--text3);text-transform:uppercase;letter-spacing:.3px;display:block;margin-bottom:4px;">Skills</strong><span style="font-size:0.9rem;color:var(--text2)">${escHtml(p.skills)}</span></div>` : ""}
                ${p.bio ? `<div style="margin-top:8px;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);"><strong style="font-size:0.72rem;color:var(--text3);text-transform:uppercase;letter-spacing:.3px;display:block;margin-bottom:4px;">About</strong><span style="font-size:0.9rem;color:var(--text2)">${escHtml(p.bio)}</span></div>` : ""}
            </div>`;
    }
    modal.classList.add("open");
}

/* ─── Interview Modal ───────────────────────────────────── */
let _ivJobId = null, _ivStudentEmail = null;

async function openInterviewModal(jobId, studentEmail) {
    _ivJobId = jobId;
    _ivStudentEmail = studentEmail;
    const modal = document.getElementById("interviewModal");
    if (!modal) return;
    const job = globalJobs.find(j => j.id == jobId);
    const app = applications.find(a => a.job_id == jobId && a.student_email === studentEmail);
    const studentDisplay = app?.student_name || studentEmail;
    document.getElementById("ivTitle").textContent =
        currentUser.role === "student" ? `Interview — ${job?.company || "Employer"}` : `Interview — ${studentDisplay}`;
    document.getElementById("ivSubtitle").textContent = job ? `Re: ${job.title} @ ${job.company}` : "";
    await renderInterviewMessages(jobId, studentEmail);
    modal.classList.add("open");
    setTimeout(() => { const input = document.getElementById("ivInput"); if (input) input.focus(); }, 200);
}

async function renderInterviewMessages(jobId, studentEmail) {
    const msgs = await api.getMessages(jobId, studentEmail);
    const box  = document.getElementById("ivMessages");
    if (!box) return;
    if (msgs.length === 0) {
        box.innerHTML = `<div class="empty-state"><i class="fas fa-comments"></i>No messages yet. Start the conversation!</div>`;
        return;
    }
    const job = globalJobs.find(j => j.id == jobId);
    const app = applications.find(a => a.job_id == jobId && a.student_email === studentEmail);
    const mySenderRole = currentUser.role === "student" ? "student" : "employer";
    box.innerHTML = msgs.map(m => {
        const isMe = m.sender === mySenderRole;
        const name = isMe ? "You" : (currentUser.role === "student" ? (job?.company || "Employer") : (app?.student_name || studentEmail));
        const time = new Date(String(m.created_at).replace(" ", "T")).toLocaleString();
        return `<div class="iv-msg ${isMe ? "iv-msg--me" : "iv-msg--them"}">
            <div class="iv-msg-bubble-row">
                <div class="iv-msg-bubble">${escHtml(m.message)}</div>
                <button class="iv-msg-delete" title="Delete message" onclick="deleteInterviewMessage(${m.id})"><i class="fas fa-trash"></i></button>
            </div>
            <div class="iv-msg-meta">${escHtml(name)} · ${time}</div>
        </div>`;
    }).join("");
    box.scrollTop = box.scrollHeight;
}

async function sendInterviewMessage() {
    const input = document.getElementById("ivInput");
    if (!input) return;
    const msg = input.value.trim();
    if (!msg) return;
    const sender = currentUser.role === "student" ? "student" : "employer";
    await api.sendMessage(_ivJobId, _ivStudentEmail, sender, msg);
    input.value = "";
    await renderInterviewMessages(_ivJobId, _ivStudentEmail);
    if (currentUser.role === "student") await renderStudentDashboard();
    else                                await renderEmployerDashboard();
}

async function deleteInterviewMessage(msgId) {
    if (!_ivJobId || !_ivStudentEmail) return;
    if (!confirm("Delete this message? This cannot be undone.")) return;
    await api.deleteMessage(msgId);
    await renderInterviewMessages(_ivJobId, _ivStudentEmail);
    if (currentUser.role === "student") await renderStudentDashboard();
    else                                await renderEmployerDashboard();
    showToast("Message deleted");
}

/* ─── Student Profile Modal ─────────────────────────────── */
async function openStudentProfileModal() {
    const modal = document.getElementById("profileEditModal");
    if (!modal) return;
    const p = await api.getStudentProfile(currentUser.email);
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ""; };

    set("profileLastName",  p.last_name);
    set("profileFirstName", p.first_name);
    set("profileMI",        p.mi);
    set("profileBirthdate", p.birthdate);
    set("profileAge",       p.age);
    set("profilePhone",     p.phone);
    set("profileAddress",   p.address);
    set("profileSkills",    p.skills);
    set("profileCourse",    p.course);
    set("profileSchool",    p.school);
    set("profileBio",       p.bio);

    const previewName = document.getElementById("previewName");
    if (previewName) previewName.textContent = currentUser.displayName;

    document.querySelectorAll("#profileEditModal .profile-tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === "personal"));
    document.querySelectorAll("#profileEditModal .profile-tab-content").forEach(c => c.classList.toggle("active", c.id === "tab-personal"));

    modal.classList.add("open");
}

async function saveStudentProfile() {
    const get = id => document.getElementById(id)?.value.trim() || "";
    const lastName = get("profileLastName"), firstName = get("profileFirstName"), mi = get("profileMI");

    await api.saveStudentProfile({
        email:     currentUser.email,
        lastName, firstName, mi,
        birthdate: get("profileBirthdate"),
        age:       get("profileAge"),
        phone:     get("profilePhone"),
        address:   get("profileAddress"),
        skills:    get("profileSkills"),
        course:    get("profileCourse"),
        school:    get("profileSchool"),
        bio:       get("profileBio")
    });

    const newDisplay = `${lastName} ${firstName} ${mi}`.trim();
    if (newDisplay) {
        currentUser.displayName = newDisplay;
        sessionStorage.setItem("cvc_user", JSON.stringify(currentUser));
    }
    document.getElementById("profileEditModal")?.classList.remove("open");
    showToast("✨ Profile saved!");
    await renderStudentDashboard();
}

function switchProfileTab(tabName) {
    document.querySelectorAll(".profile-tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tabName));
    document.querySelectorAll(".profile-tab-content").forEach(c => c.classList.toggle("active", c.id === `tab-${tabName}`));
}

/* ─── Job Detail Modal ──────────────────────────────────── */
function showJobDetails(job) {
    const modal = document.getElementById("jobDetailModal");
    if (!modal) return;
    document.getElementById("detailTitle").textContent = job.title;
    const typeIcons = { internship: "📘", fulltime: "💼", remote: "🏠" };
    document.getElementById("detailContent").innerHTML = `
        <div class="job-detail-row"><i class="fas fa-building"></i><div><strong>Company</strong><span>${escHtml(job.company)}</span></div></div>
        <div class="job-detail-row"><i class="fas fa-map-marker-alt"></i><div><strong>Location</strong><span>${escHtml(job.location || "Not specified")}</span></div></div>
        <div class="job-detail-row"><i class="fas fa-tag"></i><div><strong>Type</strong><span>${typeIcons[job.type] || ""} ${escHtml(job.type || "N/A")}</span></div></div>
        <div class="job-detail-row"><i class="fas fa-wallet"></i><div><strong>Salary</strong><span>${escHtml(job.salary || "Negotiable")}</span></div></div>
        <div class="job-detail-row"><i class="fas fa-file-alt"></i><div><strong>Description</strong><span>${escHtml(job.description || "No description.")}</span></div></div>
    `;
    const actionsEl = document.getElementById("detailActions");
    if (actionsEl && currentUser?.role === "student") {
        const applied = applications.some(a => a.job_id == job.id);
        const saved   = savedJobs.includes(Number(job.id));
        actionsEl.innerHTML = `
            <button class="btn-outline" onclick="viewCompanyInfo(${job.employer_id})">
                <i class="fas fa-building"></i> Company Info
            </button>
            <button class="btn-outline ${saved ? "saved" : ""}" onclick="toggleSaveJob(${job.id}); document.getElementById('jobDetailModal').classList.remove('open');">
                <i class="fas fa-bookmark"></i> ${saved ? "Saved" : "Save"}
            </button>
            <button class="btn-primary" ${applied ? "disabled" : ""}
                onclick="applyToJob(${job.id},'${escHtml(currentUser.email)}','${currentUser.displayName.replace(/'/g,"\\'")}'); document.getElementById('jobDetailModal').classList.remove('open');">
                <i class="fas fa-paper-plane"></i> ${applied ? "Already Applied" : "Apply Now"}
            </button>`;
    } else if (actionsEl) { actionsEl.innerHTML = ""; }
    modal.classList.add("open");
}

/* ─── Render Student Dashboard ──────────────────────────── */
async function renderStudentDashboard() {
    if (!currentUser || currentUser.role !== "student") return;

    const welcomeEl = document.getElementById("studentWelcome");
    const avatarEl  = document.getElementById("userAvatar");
    if (welcomeEl) welcomeEl.textContent = currentUser.displayName;
    if (avatarEl)  avatarEl.textContent  = "🎓";

    globalJobs   = await api.getJobs();
    applications = await api.getApplications({ studentEmail: currentUser.email });
    savedJobs    = (await api.getSavedJobs(currentUser.email)).map(Number);

    let filtered = globalJobs.filter(job => {
        const matchesType   = currentFilter === "all" || job.type === currentFilter;
        const matchesSearch = !searchKeyword ||
            job.title.toLowerCase().includes(searchKeyword) ||
            job.company.toLowerCase().includes(searchKeyword) ||
            (job.description || "").toLowerCase().includes(searchKeyword);
        const matchesLoc    = !locationFilter || (job.location || "").includes(locationFilter);
        return matchesType && matchesSearch && matchesLoc;
    });
    if (salarySort === "asc")  filtered.sort((a, b) => (parseInt(a.salary) || 0) - (parseInt(b.salary) || 0));
    if (salarySort === "desc") filtered.sort((a, b) => (parseInt(b.salary) || 0) - (parseInt(a.salary) || 0));

    const el1 = document.getElementById("totalJobsCountSt");
    const el2 = document.getElementById("appliedJobsCountSt");
    const el3 = document.getElementById("savedJobsCount");
    if (el1) el1.textContent = filtered.length;
    if (el2) el2.textContent = applications.length;
    if (el3) el3.textContent = savedJobs.length;

    // Job list
    const container = document.getElementById("studentJobList");
    if (container) {
        container.innerHTML = filtered.length === 0
            ? `<div class="empty-state"><i class="fas fa-search"></i>No jobs match your search</div>`
            : filtered.map(job => {
                const applied = applications.some(a => a.job_id == job.id);
                const saved   = savedJobs.includes(Number(job.id));
                const jobJson = encodeURIComponent(JSON.stringify(job));
                const typeLabel = { internship:"📘 Internship", fulltime:"💼 Full-Time", remote:"🏠 Remote" }[job.type] || job.type;
                return `<div class="job-card" data-type="${escHtml(job.type || "")}">
                    <div class="job-info">
                        <h4>${escHtml(job.title)}</h4>
                        <div class="job-meta">
                            <span><i class="fas fa-building"></i>${escHtml(job.company)}</span>
                            <span><i class="fas fa-map-marker-alt"></i>${escHtml(job.location || "N/A")}</span>
                            <span><i class="fas fa-wallet"></i>${escHtml(job.salary || "Negotiable")}</span>
                            <span><i class="fas fa-tag"></i>${typeLabel}</span>
                        </div>
                    </div>
                    <div class="job-actions">
                        <button class="view-details-btn" onclick='showJobDetails(JSON.parse(decodeURIComponent("${jobJson}")))'>
                            <i class="fas fa-eye"></i> Details
                        </button>
                        <button class="btn-outline" onclick="viewCompanyInfo(${job.employer_id})">
                            <i class="fas fa-building"></i> Company
                        </button>
                        <button class="btn-outline ${saved ? "saved" : ""}" onclick="toggleSaveJob(${job.id})">
                            <i class="fas fa-bookmark"></i> ${saved ? "Saved" : "Save"}
                        </button>
                        <button class="btn-primary" ${applied ? "disabled" : ""}
                            onclick="applyToJob(${job.id},'${escHtml(currentUser.email)}','${currentUser.displayName.replace(/'/g,"\\'")}')">
                            <i class="fas fa-paper-plane"></i> ${applied ? "Applied" : "Apply"}
                        </button>
                    </div>
                </div>`;
            }).join("");
    }

    // Applied list
    const appliedDiv = document.getElementById("studentAppliedList");
    if (appliedDiv) {
        if (applications.length === 0) {
            appliedDiv.innerHTML = `<div class="empty-state"><i class="fas fa-inbox"></i>No applications yet. Start applying!</div>`;
        } else {
            const withCounts = await Promise.all(applications.map(async app => {
                const msgs = await api.getMessages(app.job_id, currentUser.email);
                return { app, msgCount: msgs.length };
            }));
            const statusIcons = { Pending:"⏳", Interview:"📅", Accepted:"✅", Rejected:"❌" };
            appliedDiv.innerHTML = withCounts.map(({ app, msgCount }) => {
                const job = globalJobs.find(j => j.id == app.job_id);
                return `<div class="job-card">
                    <div class="job-info">
                        <h4>${escHtml(job?.title || "Deleted Job")}</h4>
                        <div class="job-meta">
                            <span><i class="fas fa-building"></i>${escHtml(job?.company || "—")}</span>
                            <span><i class="fas fa-calendar"></i>Applied ${new Date(String(app.applied_at).replace(" ","T")).toLocaleDateString()}</span>
                            ${msgCount > 0 ? `<span style="color:var(--accent)"><i class="fas fa-comments"></i>${msgCount} message${msgCount > 1 ? "s" : ""}</span>` : ""}
                        </div>
                    </div>
                    <div class="job-actions">
                        <span class="status-badge ${app.status || "Pending"}">${statusIcons[app.status] || "⏳"} ${app.status || "Pending"}</span>
                        ${app.status === "Interview" || msgCount > 0 ? `<button class="btn-primary" onclick="openInterviewModal(${app.job_id},'${escHtml(currentUser.email)}')">
                            <i class="fas fa-comments"></i> ${msgCount > 0 ? "Messages" : "Interview Chat"}
                        </button>` : ""}
                    </div>
                </div>`;
            }).join("");
        }
    }

    // Chart
    const statusCounts = { Pending: 0, Interview: 0, Accepted: 0, Rejected: 0 };
    applications.forEach(a => { const s = a.status || "Pending"; if (s in statusCounts) statusCounts[s]++; });
    const ctx = document.getElementById("appChart")?.getContext("2d");
    if (ctx) {
        if (appChart) appChart.destroy();
        appChart = new Chart(ctx, {
            type: "doughnut",
            data: {
                labels: Object.keys(statusCounts),
                datasets: [{ data: Object.values(statusCounts), backgroundColor: ["#C98A2C","#6D5DAF","#52B788","#B23A2E"], borderWidth: 0, hoverOffset: 6 }]
            },
            options: { responsive: true, maintainAspectRatio: true, plugins: { legend: { position: "bottom", labels: { padding: 16, font: { family: "'Manrope', sans-serif", size: 13 } } } }, cutout: "65%" }
        });
    }
}

/* ─── Render Employer Dashboard ─────────────────────────── */
async function renderEmployerDashboard() {
    if (!currentUser || currentUser.role !== "employee") return;
    const welcomeEl = document.getElementById("empWelcome");
    const avatarEl  = document.getElementById("empUserAvatar");
    if (welcomeEl) welcomeEl.textContent = currentUser.displayName;
    if (avatarEl)  avatarEl.textContent  = "🏢";

    const empId = currentUser.employerId;
    globalJobs   = await api.getJobs(empId);
    applications = await api.getApplications({ employerId: empId });

    // Job listings
    const jobsContainer = document.getElementById("employerJobsList");
    if (jobsContainer) {
        jobsContainer.innerHTML = globalJobs.length === 0
            ? `<div class="empty-state"><i class="fas fa-briefcase"></i>No jobs posted yet. Post your first job above!</div>`
            : globalJobs.map(job => {
                const appCount = applications.filter(a => a.job_id == job.id).length;
                return `<div class="job-card" data-type="${escHtml(job.type || "")}">
                    <div class="job-info" style="flex:1;">
                        <h4>${escHtml(job.title)} <span style="font-size:0.75rem;font-weight:500;background:var(--accent-bg);color:var(--accent);padding:2px 10px;border-radius:99px;margin-left:6px;">${appCount} applicant${appCount !== 1 ? "s" : ""}</span></h4>
                        <div class="job-meta">
                            <span><i class="fas fa-building"></i>${escHtml(job.company)}</span>
                            <span><i class="fas fa-tag"></i>${job.type}</span>
                            <span><i class="fas fa-wallet"></i>${escHtml(job.salary)}</span>
                        </div>
                        <div class="edit-fields">
                            <textarea id="editDesc_${job.id}" rows="2" placeholder="Description">${escHtml(job.description || "")}</textarea>
                            <input id="editSalary_${job.id}" value="${escHtml(job.salary)}" placeholder="Salary">
                        </div>
                    </div>
                    <div class="job-actions" style="flex-direction:column;align-items:flex-end;">
                        <button class="btn-primary" onclick="editJobDetails(${job.id}, document.getElementById('editDesc_${job.id}').value, document.getElementById('editSalary_${job.id}').value)">
                            <i class="fas fa-save"></i> Update
                        </button>
                        <button class="btn-danger" style="margin-top:6px;" onclick="deleteJob(${job.id})">
                            <i class="fas fa-trash"></i> Delete
                        </button>
                    </div>
                </div>`;
            }).join("");
    }

    // Applicants
    const appsContainer = document.getElementById("allApplicationsList");
    if (appsContainer) {
        if (applications.length === 0) {
            appsContainer.innerHTML = `<div class="empty-state"><i class="fas fa-users"></i>No applications yet</div>`;
        } else {
            const withCounts = await Promise.all(applications.map(async app => {
                const msgs = await api.getMessages(app.job_id, app.student_email);
                return { app, msgCount: msgs.length };
            }));
            appsContainer.innerHTML = withCounts.map(({ app, msgCount }) => {
                const job      = globalJobs.find(j => j.id == app.job_id);
                const selectId = `statusSelect_${app.job_id}_${app.student_email.replace(/[@.]/g,"_")}`;
                const statusOptions = ["Pending","Interview","Accepted","Rejected"]
                    .map(s => `<option ${app.status === s ? "selected" : ""}>${s}</option>`)
                    .join("");
                return `<div class="job-card">
                    <div class="job-info">
                        <h4>${escHtml(app.student_name || app.student_email)}</h4>
                        <div class="job-meta">
                            <span><i class="fas fa-briefcase"></i>${escHtml(job?.title || "Deleted job")}</span>
                            <span><i class="fas fa-calendar"></i>Applied ${new Date(String(app.applied_at).replace(" ","T")).toLocaleDateString()}</span>
                            ${msgCount > 0 ? `<span style="color:var(--accent)"><i class="fas fa-comments"></i>${msgCount} msg${msgCount > 1 ? "s" : ""}</span>` : ""}
                        </div>
                    </div>
                    <div class="job-actions" style="flex-wrap:wrap;">
                        <button class="btn-outline" onclick="viewApplicantProfile('${escHtml(app.student_email)}')">
                            <i class="fas fa-user"></i> Profile
                        </button>
                        <select class="app-select" id="${selectId}">${statusOptions}</select>
                        <button class="btn-primary" onclick="updateApplicationStatus(${app.job_id},'${escHtml(app.student_email)}', document.getElementById('${selectId}').value)">
                            <i class="fas fa-check"></i> Update
                        </button>
                        ${app.status === "Interview" || msgCount > 0 ? `<button class="btn-primary" style="background:linear-gradient(135deg,var(--purple),#6d28d9);" onclick="openInterviewModal(${app.job_id},'${escHtml(app.student_email)}')">
                            <i class="fas fa-comments"></i> ${msgCount > 0 ? "Messages" : "Send Interview Msg"}
                        </button>` : ""}
                    </div>
                </div>`;
            }).join("");
        }
    }
}

/* ─── Auth ──────────────────────────────────────────────── */
async function attemptLogin(email, pwd, role) {
    if (!email || !pwd || !role) { showToast("Please fill all fields"); return false; }
    const apiRole = role === "employee" ? "employee" : "student";
    try {
        const result = await api.login(apiRole, email, pwd);
        currentUser = {
            email:      result.user.email,
            role:       apiRole,
            id:         result.user.id,
            employerId: apiRole === "employee" ? result.user.id : null,
            displayName: result.displayName || email
        };
        sessionStorage.setItem("cvc_user", JSON.stringify(currentUser));
        window.location.href = apiRole === "student" ? "StudentDashboard.html" : "EmployerDashboard.html";
        return true;
    } catch (err) {
        showToast(err.error || "❌ Invalid credentials");
        return false;
    }
}

async function registerUser() {
    const role     = document.querySelector("#registerRoleTabs .role-tab.active")?.dataset.role;
    const name     = document.getElementById("registerName")?.value.trim();
    const email    = document.getElementById("registerEmail")?.value.trim();
    const password = document.getElementById("registerPassword")?.value;
    if (!name || !email || !password) { showToast("Please fill all fields"); return; }
    if (!email.includes("@"))         { showToast("Please enter a valid email"); return; }
    if (password.length < 4)          { showToast("Password must be at least 4 characters"); return; }

    try {
        await api.register(role, name, email, password);
        showToast("🎉 Account created! Redirecting...");
        setTimeout(() => { window.location.href = "JobPortalindex.html"; }, 1600);
    } catch (err) {
        showToast(err.error || "Registration failed");
    }
}

function logout() {
    currentUser = null;
    sessionStorage.removeItem("cvc_user");
    showToast("Logged out");
    setTimeout(() => { window.location.href = "JobPortalindex.html"; }, 600);
}

async function checkSession() {
    const stored = sessionStorage.getItem("cvc_user");
    if (!stored) return;
    currentUser = JSON.parse(stored);
    if (currentUser.role === "student")       await renderStudentDashboard();
    else if (currentUser.role === "employee") await renderEmployerDashboard();
}

/* ─── Dark Mode ─────────────────────────────────────────── */
function initDarkMode() {
    if (localStorage.getItem("cvc_dark") === "1") document.body.classList.add("dark-mode");
    ["darkModeToggle","darkModeToggle2"].forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        updateDarkIcon(btn);
        btn.onclick = () => {
            document.body.classList.toggle("dark-mode");
            localStorage.setItem("cvc_dark", document.body.classList.contains("dark-mode") ? "1" : "0");
            updateDarkIcon(btn);
        };
    });
}
function updateDarkIcon(btn) {
    const icon = btn.querySelector("i");
    if (!icon) return;
    icon.className = document.body.classList.contains("dark-mode") ? "fas fa-sun" : "fas fa-moon";
}

/* ─── Bind Events ───────────────────────────────────────── */
function bindEvents() {
    // Login
    const loginBtn = document.getElementById("doLoginBtn");
    if (loginBtn) loginBtn.onclick = () => {
        const role  = document.querySelector("#roleTabs .role-tab.active")?.dataset.role;
        const email = document.getElementById("loginEmail")?.value.trim();
        const pass  = document.getElementById("loginPassword")?.value;
        attemptLogin(email, pass, role);
    };

    // Register
    const registerBtn = document.getElementById("registerBtn");
    if (registerBtn) registerBtn.onclick = registerUser;

    // Role tabs
    ["#roleTabs .role-tab", "#registerRoleTabs .role-tab"].forEach(sel => {
        document.querySelectorAll(sel).forEach(tab => {
            tab.onclick = () => {
                const parent = tab.closest(".role-tabs");
                parent.querySelectorAll(".role-tab").forEach(t => t.classList.remove("active"));
                tab.classList.add("active");
            };
        });
    });

    // Logout
    document.getElementById("empLogoutBtn")?.addEventListener("click", logout);
    document.getElementById("studentLogoutBtn")?.addEventListener("click", logout);

    // Post job
    document.getElementById("postJobBtn")?.addEventListener("click", postNewJob);

    // Student profile trigger
    document.getElementById("profileTrigger")?.addEventListener("click", openStudentProfileModal);

    // Student profile modal save/cancel/close
    document.getElementById("saveProfileBtn")?.addEventListener("click", saveStudentProfile);
    document.getElementById("cancelProfileBtn")?.addEventListener("click", () => document.getElementById("profileEditModal")?.classList.remove("open"));
    document.getElementById("closeProfileModal")?.addEventListener("click", () => document.getElementById("profileEditModal")?.classList.remove("open"));

    // Profile tabs — generic handling across all modals
    document.querySelectorAll(".profile-tab-btn").forEach(btn => {
        btn.onclick = () => {
            const parentTabs = btn.closest(".profile-tabs");
            const parentModal = btn.closest(".modal-box");
            if (!parentTabs || !parentModal) return;
            parentTabs.querySelectorAll(".profile-tab-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            parentModal.querySelectorAll(".profile-tab-content").forEach(c => c.classList.remove("active"));
            const target = parentModal.querySelector(`#tab-${btn.dataset.tab}`);
            if (target) target.classList.add("active");
        };
    });

    // Employer profile trigger → opens company profile modal
    document.getElementById("empProfileTrigger")?.addEventListener("click", openCompanyProfileModal);

    // Company profile modal
    document.getElementById("saveCompanyProfileBtn")?.addEventListener("click", saveCompanyProfile);
    document.getElementById("cancelCompanyProfileBtn")?.addEventListener("click", () => document.getElementById("companyProfileModal")?.classList.remove("open"));
    document.getElementById("closeCompanyProfileModal")?.addEventListener("click", () => document.getElementById("companyProfileModal")?.classList.remove("open"));

    // Company info modal (student side)
    document.getElementById("closeCompanyInfoModal")?.addEventListener("click", () => document.getElementById("companyInfoModal")?.classList.remove("open"));

    // Job detail modal close
    document.getElementById("closeJobDetailModal")?.addEventListener("click", () => document.getElementById("jobDetailModal")?.classList.remove("open"));

    // Applicant detail modal close
    document.getElementById("closeApplicantDetailModal")?.addEventListener("click", () => document.getElementById("applicantDetailModal")?.classList.remove("open"));

    // Interview modal
    document.getElementById("closeInterviewModal")?.addEventListener("click", () => document.getElementById("interviewModal")?.classList.remove("open"));
    document.getElementById("ivSendBtn")?.addEventListener("click", sendInterviewMessage);
    document.getElementById("ivInput")?.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendInterviewMessage(); } });

    // Close modals on overlay click
    document.querySelectorAll(".modal-overlay").forEach(overlay => {
        overlay.addEventListener("click", e => { if (e.target === overlay) overlay.classList.remove("open"); });
    });

    // Escape key
    document.addEventListener("keydown", e => {
        if (e.key === "Escape") document.querySelectorAll(".modal-overlay.open").forEach(m => m.classList.remove("open"));
    });

    // Student filter buttons
    document.querySelectorAll("#studentFilterContainer .filter-btn").forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll("#studentFilterContainer .filter-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentFilter = btn.dataset.filter;
            renderStudentDashboard();
        };
    });

    // Search / sort
    document.getElementById("jobSearch")?.addEventListener("input", e => { searchKeyword = e.target.value.toLowerCase().trim(); renderStudentDashboard(); });
    document.getElementById("locationFilter")?.addEventListener("change", e => { locationFilter = e.target.value; renderStudentDashboard(); });
    document.getElementById("salarySort")?.addEventListener("change", e => { salarySort = e.target.value; renderStudentDashboard(); });
}

/* ─── Expose globals (needed for inline onclick="..." handlers) ── */
window.showJobDetails            = showJobDetails;
window.toggleSaveJob             = toggleSaveJob;
window.applyToJob                = applyToJob;
window.deleteJob                 = deleteJob;
window.editJobDetails            = editJobDetails;
window.updateApplicationStatus   = updateApplicationStatus;
window.viewApplicantProfile      = viewApplicantProfile;
window.openInterviewModal        = openInterviewModal;
window.viewCompanyInfo           = viewCompanyInfo;
window.deleteInterviewMessage    = deleteInterviewMessage;

/* ─── Init ──────────────────────────────────────────────── */
initDarkMode();
bindEvents();
checkSession();
