export const GOALS = [
  {
    id: "finance",
    name: "Manage Finance through Rocket",
    shortName: "Finance",
    priority: 1,
    progress: 30,
    projects: ["WGU coursework", "Programming development"],
    tasks: [],
  },
  {
    id: "bscs",
    name: "Complete BSCS",
    shortName: "BSCS",
    priority: 1,
    progress: 70,
    projects: ["WGU coursework", "Programming development"],
    tasks: [
      {
        name: "Complete Java Module 4 practice problems",
        project: "WGU coursework",
        estimatedMinutes: 45,
        priority: 1,
      },
      {
        name: "Build one small programming exercise",
        project: "Programming development",
        estimatedMinutes: 35,
        priority: 2,
      },
    ],
  },
  {
    id: "atg-dpt",
    name: "ATG / DPT Path",
    shortName: "ATG / DPT",
    priority: 2,
    progress: 40,
    projects: ["ATG L1", "DPT preparation"],
    tasks: [
      {
        name: "Review ATG L1 study notes",
        project: "ATG L1",
        estimatedMinutes: 30,
        priority: 1,
      },
      {
        name: "Research one DPT prerequisite",
        project: "DPT preparation",
        estimatedMinutes: 25,
        priority: 2,
      },
    ],
  },
  {
    id: "proverbs",
    name: "Ethiopian Proverbs Project",
    shortName: "Ethiopian Proverbs",
    priority: 3,
    progress: 60,
    projects: ["Content creation", "Proverb book"],
    tasks: [
      {
        name: "Write two proverb scripts",
        project: "Content creation",
        estimatedMinutes: 30,
        priority: 1,
      },
      {
        name: "Edit one page of the proverb book",
        project: "Proverb book",
        estimatedMinutes: 25,
        priority: 2,
      },
    ],
  },
];

export const WEEKLY_FRAMEWORK = {
  monday: { type: "deep", capacityMinutes: 180 },
  tuesday: { type: "normal", capacityMinutes: 150 },
  wednesday: { type: "light", capacityMinutes: 90 },
  thursday: { type: "deep", capacityMinutes: 180 },
  friday: { type: "normal", capacityMinutes: 150 },
  saturday: { type: "light", capacityMinutes: 90 },
  sunday: { type: "rest", capacityMinutes: 0 },
};

export const DAY_LABELS = {
  deep: "Deep work",
  normal: "Normal work",
  light: "Light day",
  rest: "Rest day",
};

export function getDayFramework(date = new Date()) {
  const day = date
    .toLocaleDateString("en-US", { weekday: "long" })
    .toLowerCase();
  return { day, ...WEEKLY_FRAMEWORK[day] };
}
