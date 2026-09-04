import { useEffect, useState } from "react";
import "./App.css";
import { DAY_LABELS, GOALS, getDayFramework } from "./config";
import {
  archiveWeekToGoogle,
  disconnectGoogle,
  getGoogleDocs,
  getGoogleStatus,
} from "./services/googleDocs";

const STORAGE_KEY = "daily-execution-state";
const WEEK_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];
const weekStart = (date = new Date()) => {
  const result = new Date(date);
  const day = result.getDay();
  result.setDate(result.getDate() - (day === 0 ? 6 : day - 1));
  return result.toISOString().slice(0, 10);
};
const makeWeeklyPlan = () => ({ week: weekStart(), tasks: [] });
const todayKey = () => new Date().toISOString().slice(0, 10);
const formatDate = (date) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
const makeTasks = () =>
  GOALS.flatMap((goal) =>
    goal.tasks.map((task, index) => ({
      id: `${goal.id}-${index}`,
      goalId: goal.id,
      goal: goal.shortName,
      ...task,
      status: "pending",
      notes: "",
      actualMinutes: null,
      startedAt: null,
    })),
  ).sort((a, b) => a.priority - b.priority);
function makeDay(date = todayKey()) {
  const framework = getDayFramework(new Date(`${date}T12:00:00`));
  return {
    date,
    ...framework,
    tasks: framework.type === "rest" ? [] : makeTasks(),
    restCompleted: false,
    review: null,
  };
}
function loadState() {
  try {
    return (
      JSON.parse(localStorage.getItem(STORAGE_KEY)) || {
        active: makeDay(),
        weekly: makeWeeklyPlan(),
      }
    );
  } catch {
    return { active: makeDay(), weekly: makeWeeklyPlan() };
  }
}
function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function App() {
  const [state, setState] = useState(loadState);
  const [page, setPage] = useState("week");
  const [showReview, setShowReview] = useState(false);
  const [activeTimer, setActiveTimer] = useState(null);
  const [now, setNow] = useState(0);
  const [googleStatus, setGoogleStatus] = useState({
    connected: false,
    loading: true,
    docs: [],
    error: "",
  });
  const [selectedDocId, setSelectedDocId] = useState(
    () => localStorage.getItem("daily-google-doc-id") || "",
  );
  const active = state.active;
  const weekly = state.weekly || makeWeeklyPlan();
  const plannedMinutes = active.tasks.reduce(
    (sum, task) => sum + task.estimatedMinutes,
    0,
  );
  const completedMinutes = active.tasks
    .filter((task) => task.status === "completed")
    .reduce(
      (sum, task) => sum + (task.actualMinutes ?? task.estimatedMinutes),
      0,
    );
  const remaining = Math.max(0, active.capacityMinutes - plannedMinutes);
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);
  useEffect(() => {
    if (!activeTimer) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activeTimer]);
  useEffect(() => {
    getGoogleStatus()
      .then((status) =>
        setGoogleStatus((current) => ({
          ...current,
          ...status,
          loading: false,
        })),
      )
      .catch((error) =>
        setGoogleStatus({
          connected: false,
          loading: false,
          docs: [],
          error: error.message,
        }),
      );
  }, []);
  const refreshGoogleDocs = () =>
    getGoogleDocs()
      .then((docs) =>
        setGoogleStatus((current) => ({ ...current, docs, error: "" })),
      )
      .catch((error) =>
        setGoogleStatus((current) => ({ ...current, error: error.message })),
      );
  const connectGoogle = () => {
    window.location.href = "/api/google/auth";
  };
  const selectGoogleDoc = (documentId) => {
    setSelectedDocId(documentId);
    localStorage.setItem("daily-google-doc-id", documentId);
  };
  const disconnect = () =>
    disconnectGoogle().then(() => {
      setGoogleStatus((current) => ({
        ...current,
        connected: false,
        docs: [],
      }));
      setSelectedDocId("");
      localStorage.removeItem("daily-google-doc-id");
    });
  const updateTask = (id, update) =>
    setState((current) => ({
      ...current,
      active: {
        ...current.active,
        tasks: current.active.tasks.map((task) =>
          task.id === id ? { ...task, ...update } : task,
        ),
      },
    }));
  const startTask = (task) => {
    updateTask(task.id, {
      status: "in_progress",
      startedAt: task.startedAt || new Date().toISOString(),
    });
    setActiveTimer(task.id);
  };
  const completeTask = (task) => {
    const actual = task.startedAt
      ? Math.max(
          1,
          Math.round((now - new Date(task.startedAt).getTime()) / 60000),
        )
      : task.actualMinutes;
    updateTask(task.id, {
      status: "completed",
      actualMinutes: actual || task.estimatedMinutes,
    });
    setActiveTimer(null);
  };
  const deferTask = (task) => {
    updateTask(task.id, { status: "deferred" });
    if (activeTimer === task.id) setActiveTimer(null);
  };
  const moveTask = (index, direction) =>
    setState((current) => {
      const tasks = [...current.active.tasks];
      const next = index + direction;
      if (next < 0 || next >= tasks.length) return current;
      [tasks[index], tasks[next]] = [tasks[next], tasks[index]];
      return { ...current, active: { ...current.active, tasks } };
    });
  const archive = (record) =>
    setState((current) => ({
      active: makeDay(),
      history: [
        ...(current.history || []),
        { ...record, archivedAt: new Date().toISOString() },
      ],
    }));
  const recordMarkdown = (record) =>
    `# ${formatDate(new Date(`${record.date}T12:00:00`))}\n\n## Day Type\n\n${DAY_LABELS[record.type]}\n\n## Capacity\n\n${record.capacityMinutes} minutes\n\n## Planned\n\n${
      record.tasks
        .filter((task) => task.status !== "deferred")
        .map((task) => `- ${task.name} - ${task.estimatedMinutes}m`)
        .join("\n") || "- None"
    }\n\n## Completed\n\n${
      record.tasks
        .filter((task) => task.status === "completed")
        .map((task) => `- ${task.name} - ${task.actualMinutes}m`)
        .join("\n") || "- None"
    }\n\n## Deferred\n\n${
      record.tasks
        .filter((task) => task.status === "deferred")
        .map((task) => `- ${task.name}`)
        .join("\n") || "- None"
    }\n\n## Reflection\n\n${record.review?.accomplished || "No reflection recorded."}\n\n## Ratings\n\nEnergy: ${record.review?.energy || "-"} / 5\nDay: ${record.review?.dayRating || "-"} / 5\n`;
  const timerTask = active.tasks.find((task) => task.id === activeTimer);
  const timerLabel = timerTask
    ? `${Math.floor((now - new Date(timerTask.startedAt).getTime()) / 60000)}m`
    : null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">D/</span>
          <span>Daily Practice</span>
        </div>
        <nav>
          {[
            ["week", "Week"],
            ["framework", "6-Day Framework"],
            ["sunday", "Sunday"],
            ["goals", "Goals"],
            ["archive", "Archive"],
            ["settings", "Settings"],
          ].map(([id, label]) => (
            <button
              className={page === id ? "nav-active" : ""}
              onClick={() => setPage(id)}
              key={id}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="date-chip">{active.date}</div>
      </header>
      <main>
        {page === "week" && (
          <WeeklyPlanner
            weekly={weekly}
            setState={setState}
            googleStatus={googleStatus}
            selectedDocId={selectedDocId}
            onArchiveToGoogle={() => archiveWeekToGoogle(selectedDocId, weekly)}
          />
        )}
        {page === "today" && (
          <>
            <section className="intro">
              <div>
                <p className="eyebrow">Your daily practice</p>
                <h1>{formatDate(new Date(`${active.date}T12:00:00`))}</h1>
                <p className="subtle">
                  Direction becomes action in small, honest steps.
                </p>
              </div>
              <div className="day-badge">
                <span>{DAY_LABELS[active.type]}</span>
                <strong>
                  {active.capacityMinutes}
                  <small> min available</small>
                </strong>
              </div>
            </section>
            {active.type === "rest" ? (
              <section className="rest-panel">
                <div className="rest-icon">//</div>
                <p className="eyebrow">Rest day</p>
                <h2>No work is scheduled today.</h2>
                <p>Recovery protects the work that matters tomorrow.</p>
                <button
                  className="primary"
                  onClick={() =>
                    setState((current) => ({
                      ...current,
                      active: { ...current.active, restCompleted: true },
                    }))
                  }
                >
                  {active.restCompleted
                    ? "Rest day complete"
                    : "Complete rest day"}
                </button>
              </section>
            ) : (
              <>
                <section className="metrics">
                  <div>
                    <span>Planned</span>
                    <strong>
                      {plannedMinutes}
                      <small> min</small>
                    </strong>
                  </div>
                  <div>
                    <span>Completed</span>
                    <strong>
                      {completedMinutes}
                      <small> min</small>
                    </strong>
                  </div>
                  <div>
                    <span>Remaining capacity</span>
                    <strong>
                      {remaining}
                      <small> min</small>
                    </strong>
                  </div>
                  <div className="progress-track">
                    <i
                      style={{
                        width: `${plannedMinutes ? Math.min(100, (completedMinutes / plannedMinutes) * 100) : 0}%`,
                      }}
                    />
                  </div>
                </section>
                <section className="task-section">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Today&apos;s work</p>
                      <h2>
                        {
                          active.tasks.filter(
                            (task) => task.status !== "deferred",
                          ).length
                        }{" "}
                        focused tasks
                      </h2>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setShowReview(true)}
                    >
                      End day <span>-&gt;</span>
                    </button>
                  </div>
                  <div className="task-list">
                    {active.tasks.map((task, index) => (
                      <article
                        className={`task-row ${task.status}`}
                        key={task.id}
                      >
                        <div className="task-order">
                          <button
                            onClick={() => moveTask(index, -1)}
                            aria-label="Move up"
                          >
                            ^
                          </button>
                          <button
                            onClick={() => moveTask(index, 1)}
                            aria-label="Move down"
                          >
                            v
                          </button>
                        </div>
                        <button
                          className="check"
                          onClick={() =>
                            task.status === "completed"
                              ? updateTask(task.id, {
                                  status: "pending",
                                  actualMinutes: null,
                                })
                              : completeTask(task)
                          }
                          aria-label="Complete task"
                        >
                          {task.status === "completed" ? "x" : ""}
                        </button>
                        <div className="task-copy">
                          <div className="task-meta">
                            <span>{task.goal}</span>
                            <em>{task.project}</em>
                          </div>
                          <h3>{task.name}</h3>
                          <p>
                            {task.status === "deferred"
                              ? "Deferred for a future work day"
                              : `Estimated ${task.estimatedMinutes} min${task.actualMinutes ? ` / Actual ${task.actualMinutes} min` : ""}`}
                          </p>
                        </div>
                        {activeTimer === task.id && (
                          <span className="timer">{timerLabel}</span>
                        )}
                        <div className="task-actions">
                          {task.status !== "completed" &&
                            task.status !== "deferred" && (
                              <button
                                onClick={() =>
                                  activeTimer === task.id
                                    ? completeTask(task)
                                    : startTask(task)
                                }
                              >
                                {activeTimer === task.id ? "Finish" : "Start"}
                              </button>
                            )}
                          {task.status !== "completed" &&
                            task.status !== "deferred" && (
                              <button
                                className="quiet"
                                onClick={() => deferTask(task)}
                              >
                                Defer
                              </button>
                            )}
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              </>
            )}
          </>
        )}
        {page === "goals" && <Goals />}
        {page === "framework" && <SixDayFramework />}
        {page === "sunday" && <Sunday />}
        {page === "archive" && (
          <Archive
            history={state.history || []}
            download={(record) =>
              download(
                `${record.date}.md`,
                recordMarkdown(record),
                "text/markdown",
              )
            }
            exportAll={() =>
              download(
                "daily-history.json",
                JSON.stringify(state.history || [], null, 2),
                "application/json",
              )
            }
          />
        )}
        {page === "settings" && (
          <Settings
            googleStatus={googleStatus}
            selectedDocId={selectedDocId}
            onConnect={connectGoogle}
            onDisconnect={disconnect}
            onSelectDoc={selectGoogleDoc}
            onLoadDocs={refreshGoogleDocs}
          />
        )}
      </main>
      {showReview && (
        <Review
          active={active}
          onClose={() => setShowReview(false)}
          onSave={(review) => {
            setState((current) => ({
              ...current,
              active: { ...current.active, review },
            }));
            setShowReview(false);
          }}
          onArchive={() => {
            archive({ ...active, review: active.review || {} });
            setShowReview(false);
          }}
          download={() =>
            download(
              `${active.date}.md`,
              recordMarkdown(active),
              "text/markdown",
            )
          }
        />
      )}
    </div>
  );
}

function WeeklyPlanner({
  weekly,
  setState,
  googleStatus,
  selectedDocId,
  onArchiveToGoogle,
}) {
  const [draft, setDraft] = useState({
    name: "",
    day: "monday",
    estimatedMinutes: "",
    goalId: GOALS[0].id,
  });
  const [googleMessage, setGoogleMessage] = useState("");
  const tasks = weekly.tasks || [];
  const settled =
    tasks.length > 0 &&
    tasks.every(
      (task) => task.status === "completed" || task.status === "skipped",
    );
  const updateWeekly = (nextTasks) =>
    setState((current) => ({
      ...current,
      weekly: { ...weekly, tasks: nextTasks },
    }));
  const addTask = (event) => {
    event.preventDefault();
    if (!draft.name.trim()) return;
    const goal = GOALS.find((item) => item.id === draft.goalId) || GOALS[0];
    updateWeekly([
      ...tasks,
      {
        id: `${Date.now()}-${tasks.length}`,
        name: draft.name.trim(),
        day: draft.day,
        goalId: goal.id,
        goal: goal.shortName,
        estimatedMinutes: Number(draft.estimatedMinutes) || 0,
        status: "pending",
      },
    ]);
    setDraft({
      name: "",
      day: draft.day,
      estimatedMinutes: "",
      goalId: draft.goalId,
    });
  };
  const weeklyMarkdown = `# Weekly Tasks - week of ${weekly.week}\n\n${WEEK_DAYS.map(
    (day) =>
      `## ${day[0].toUpperCase()}${day.slice(1)}\n\n${
        tasks
          .filter((task) => task.day === day)
          .map(
            (task) =>
              `- [${task.status === "completed" ? "x" : task.status === "skipped" ? "-" : " "}] ${task.name}${task.estimatedMinutes ? ` - ${task.estimatedMinutes}m` : ""}`,
          )
          .join("\n") || "- No tasks"
      }`,
  ).join("\n\n")}`;
  const exportFile = (content, type, filename) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <section className="page week-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Plan with intention</p>
          <h1>Weekly tasks</h1>
          <p className="subtle">
            Add the work, connect it to a goal, then give each task a home in
            the week.
          </p>
        </div>
        <span className="week-label">Week of {weekly.week}</span>
      </div>
      <form className="task-form" onSubmit={addTask}>
        <input
          aria-label="Task name"
          placeholder="Add a specific task..."
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
        <select
          aria-label="Overarching goal"
          value={draft.goalId}
          onChange={(event) =>
            setDraft({ ...draft, goalId: event.target.value })
          }
        >
          {GOALS.map((goal) => (
            <option key={goal.id} value={goal.id}>
              {goal.shortName}
            </option>
          ))}
        </select>
        <input
          className="minutes-input"
          aria-label="Estimated minutes"
          type="number"
          min="0"
          placeholder="Min"
          value={draft.estimatedMinutes}
          onChange={(event) =>
            setDraft({ ...draft, estimatedMinutes: event.target.value })
          }
        />
        <select
          value={draft.day}
          onChange={(event) => setDraft({ ...draft, day: event.target.value })}
        >
          {WEEK_DAYS.map((day) => (
            <option key={day} value={day}>
              {day[0].toUpperCase() + day.slice(1)}
            </option>
          ))}
        </select>
        <button className="primary" type="submit">
          Add task
        </button>
      </form>
      <div className="week-grid">
        {WEEK_DAYS.map((day) => (
          <section className="day-column" key={day}>
            <header>
              <span>{day.slice(0, 3)}</span>
              <strong>{tasks.filter((task) => task.day === day).length}</strong>
            </header>
            {tasks
              .filter((task) => task.day === day)
              .map((task) => (
                <article className={`week-task ${task.status}`} key={task.id}>
                  <button
                    className="week-check"
                    onClick={() =>
                      updateWeekly(
                        tasks.map((item) =>
                          item.id === task.id
                            ? {
                                ...item,
                                status:
                                  item.status === "completed"
                                    ? "pending"
                                    : "completed",
                              }
                            : item,
                        ),
                      )
                    }
                    aria-label={`Mark ${task.name} complete`}
                  >
                    {task.status === "completed" ? "x" : ""}
                  </button>
                  <div>
                    <span className="week-goal">
                      {task.goal || "Unassigned goal"}
                    </span>
                    <h3>{task.name}</h3>
                    {task.estimatedMinutes > 0 && (
                      <p>{task.estimatedMinutes} min</p>
                    )}
                  </div>
                  <button
                    className="skip-button"
                    onClick={() =>
                      updateWeekly(
                        tasks.map((item) =>
                          item.id === task.id
                            ? {
                                ...item,
                                status:
                                  item.status === "skipped"
                                    ? "pending"
                                    : "skipped",
                              }
                            : item,
                        ),
                      )
                    }
                  >
                    {task.status === "skipped" ? "Undo" : "Skip"}
                  </button>
                </article>
              ))}
          </section>
        ))}
      </div>
      <div className={`weekly-export ${settled ? "ready" : ""}`}>
        <div>
          <p className="eyebrow">
            {settled ? "Week complete" : "Weekly closeout"}
          </p>
          <h2>
            {settled
              ? "Record what you planned."
              : "Finish or skip every task to close the week."}
          </h2>
        </div>
        {settled && (
          <div className="export-actions">
            <button
              className="secondary"
              onClick={() =>
                exportFile(
                  weeklyMarkdown,
                  "text/markdown",
                  `weekly-tasks-${weekly.week}.md`,
                )
              }
            >
              Download Markdown
            </button>
            <button
              className="secondary"
              disabled={!googleStatus.connected || !selectedDocId}
              onClick={() =>
                onArchiveToGoogle()
                  .then(() =>
                    setGoogleMessage("Weekly tasks archived to Google Docs."),
                  )
                  .catch((error) => setGoogleMessage(error.message))
              }
            >
              Archive to Google Doc
            </button>
            <button
              className="secondary"
              onClick={() =>
                exportFile(
                  JSON.stringify(weekly, null, 2),
                  "application/json",
                  `weekly-tasks-${weekly.week}.json`,
                )
              }
            >
              Export JSON
            </button>
          </div>
        )}
      </div>
      {settled && (
        <p className="google-feedback">
          {googleMessage ||
            (googleStatus.connected
              ? "Google Docs is connected. Select a document in Settings before archiving."
              : "Connect Google Docs in Settings to archive this week online.")}
        </p>
      )}
    </section>
  );
}

function Goals() {
  return (
    <section className="page">
      <p className="eyebrow">Direction</p>
      <h1>Medium-term goals</h1>
      <p className="subtle">
        A compass for choosing what deserves attention today.
      </p>
      <div className="goal-grid">
        {GOALS.map((goal) => (
          <article className="goal-card" key={goal.id}>
            <div className="goal-title">
              <span>0{goal.priority}</span>
              <h2>{goal.name}</h2>
            </div>
            <div className="goal-progress">
              <i style={{ width: `${goal.progress}%` }} />
            </div>
            <strong>{goal.progress}%</strong>
            <p>{goal.projects.join(" / ")}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
function Archive({ history, download, exportAll }) {
  return (
    <section className="page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">What actually happened</p>
          <h1>Archive</h1>
        </div>
        <button className="secondary" onClick={exportAll}>
          Export all history
        </button>
      </div>
      {history.length === 0 ? (
        <div className="empty">
          <h2>No archived days yet.</h2>
          <p>Complete a day, then archive its record here.</p>
        </div>
      ) : (
        <div className="archive-list">
          {[...history].reverse().map((record) => (
            <article key={`${record.date}-${record.archivedAt}`}>
              <div>
                <span>{record.date}</span>
                <h2>{DAY_LABELS[record.type]}</h2>
              </div>
              <p>
                {
                  record.tasks.filter((task) => task.status === "completed")
                    .length
                }{" "}
                completed /{" "}
                {
                  record.tasks.filter((task) => task.status === "deferred")
                    .length
                }{" "}
                deferred
              </p>
              <button className="text-button" onClick={() => download(record)}>
                Download .md
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function SixDayFramework() {
  const parts = [
    [
      "01",
      "Clock In",
      "Arrive, orient, and decide what deserves your best attention.",
      ["Prayer", "Shower", "Brush", "Floss", "Breakfast / coffee"],
    ],
    [
      "02",
      "Deep Work",
      "Focused work on the highest-value task, with distractions kept out.",
      ["BSCS classes (2026-2027)"],
    ],
    [
      "03",
      "Maintenance Work",
      "Keep the system moving with admin, communication, and upkeep.",
      [
        "Lunch",
        "Laundry",
        "Light organization",
        "Work out",
        "Games with friends",
        "Create for some light genuine fun",
        "Finance",
      ],
    ],
    [
      "04",
      "Clock Out",
      "Close open loops, capture the next step, and end the workday deliberately.",
      [
        "Movies",
        "TV show",
        "Catch up with romantic partner",
        "Cook for the next day, or cook once a week for the week (chipotle chicken meal)",
        "Prayer",
        "Scripture (liturgical)",
        "Sleep",
      ],
    ],
  ];

  return (
    <section className="page framework-page">
      <p className="eyebrow">Daily operating rhythm</p>
      <h1>6-day framework (2026-2027)</h1>
      <p className="subtle">Four deliberate parts to every workday.</p>
      <div className="framework-table-wrap">
        <table className="framework-table">
          <thead>
            <tr>
              <th scope="col">Part</th>
              <th scope="col">Purpose</th>
              <th scope="col">Tasks</th>
            </tr>
          </thead>
          <tbody>
            {parts.map(([number, name, purpose, tasks]) => (
              <tr key={name}>
                <th scope="row">
                  <span className="framework-number">{number}</span>
                  {name}
                </th>
                <td>{purpose}</td>
                <td className="framework-tasks">
                  {tasks.length > 0 ? (
                    <ul>
                      {tasks.map((task) => (
                        <li key={task}>{task}</li>
                      ))}
                    </ul>
                  ) : (
                    "Tasks to be added"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Sunday() {
  const hobbies = [
    "Church liturgical services",
    "ATG",
    "Ethiopian Proverbs Project",
    "(Future) Theological or ATG Coaching Prep",
  ];

  return (
    <section className="page sunday-page">
      <p className="eyebrow">Weekly space</p>
      <h1>Sunday</h1>
      <p className="subtle">A slower day for worship, hobbies, and thoughtful preparation.</p>
      <div className="hobby-panel">
        <p className="eyebrow">Hobbies</p>
        <ul className="hobby-list">
          {hobbies.map((hobby) => (
            <li key={hobby}>{hobby}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Settings({
  googleStatus,
  selectedDocId,
  onConnect,
  onDisconnect,
  onSelectDoc,
  onLoadDocs,
}) {
  return (
    <section className="page">
      <p className="eyebrow">Configuration</p>
      <h1>Settings</h1>
      <div className="settings-panel">
        <span className="status-dot" /> Local storage is active
        <h2>Google Docs</h2>
        <p>
          {googleStatus.connected
            ? "Connected. Choose the document that should receive each weekly archive."
            : "Connect Google to append completed weekly plans to a document. Markdown and JSON exports remain available offline."}
        </p>
        {!googleStatus.connected ? (
          <button className="secondary" onClick={onConnect}>
            Connect Google account
          </button>
        ) : (
          <>
            <button className="secondary" onClick={onLoadDocs}>
              Load Google Docs
            </button>
            {googleStatus.docs.length > 0 && (
              <select
                className="google-doc-select"
                value={selectedDocId}
                onChange={(event) => onSelectDoc(event.target.value)}
              >
                <option value="">Select an archive document</option>
                {googleStatus.docs.map((doc) => (
                  <option value={doc.id} key={doc.id}>
                    {doc.name}
                  </option>
                ))}
              </select>
            )}
            <button className="text-button" onClick={onDisconnect}>
              Disconnect
            </button>
          </>
        )}
        {googleStatus.error && (
          <p className="google-error">{googleStatus.error}</p>
        )}
      </div>
    </section>
  );
}
function Review({ active, onClose, onSave, onArchive, download }) {
  const [review, setReview] = useState(
    active.review || {
      accomplished: "",
      wentWell: "",
      obstacle: "",
      carryForward: "",
      energy: 3,
      dayRating: 3,
    },
  );
  const update = (key, value) =>
    setReview((current) => ({ ...current, [key]: value }));
  return (
    <div className="modal-backdrop">
      <section className="review">
        <button className="close" onClick={onClose}>
          x
        </button>
        <p className="eyebrow">End of day</p>
        <h1>Take a clear look back.</h1>
        <div className="review-columns">
          <div>
            <h2>Today&apos;s plan</h2>
            <p>
              {active.tasks.filter((task) => task.status !== "deferred").length}{" "}
              tasks /{" "}
              {active.tasks.reduce(
                (sum, task) => sum + task.estimatedMinutes,
                0,
              )}{" "}
              min planned
            </p>
            <h2>Completed</h2>
            <p>
              {active.tasks
                .filter((task) => task.status === "completed")
                .map((task) => task.name)
                .join(", ") || "Nothing completed yet."}
            </p>
            <h2>Deferred</h2>
            <p>
              {active.tasks
                .filter((task) => task.status === "deferred")
                .map((task) => task.name)
                .join(", ") || "Nothing deferred."}
            </p>
          </div>
          <div className="reflection">
            <label>
              What did you accomplish?
              <textarea
                value={review.accomplished}
                onChange={(event) => update("accomplished", event.target.value)}
              />
            </label>
            <label>
              What went well?
              <textarea
                value={review.wentWell}
                onChange={(event) => update("wentWell", event.target.value)}
              />
            </label>
            <label>
              What got in the way?
              <textarea
                value={review.obstacle}
                onChange={(event) => update("obstacle", event.target.value)}
              />
            </label>
            <label>
              What should carry forward?
              <textarea
                value={review.carryForward}
                onChange={(event) => update("carryForward", event.target.value)}
              />
            </label>
            <div className="ratings">
              <label>
                Energy{" "}
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={review.energy}
                  onChange={(event) => update("energy", event.target.value)}
                />
              </label>
              <label>
                Day{" "}
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={review.dayRating}
                  onChange={(event) => update("dayRating", event.target.value)}
                />
              </label>
            </div>
          </div>
        </div>
        <div className="review-actions">
          <button
            className="secondary"
            onClick={() => {
              onSave(review);
              download();
            }}
          >
            Download record
          </button>
          <button
            className="primary"
            onClick={() => {
              onSave(review);
              onArchive();
            }}
          >
            Archive day
          </button>
        </div>
      </section>
    </div>
  );
}

export default App;
