export type ProgressionLevel = {
  level: number;
  experience: number;
  currentLevelExperience: number;
  nextLevelExperience: number;
  progressPercent: number;
};

const EXPERIENCE_PER_LEVEL = 100;

export function calculateProgressionLevel(experience: number): ProgressionLevel {
  const safeExperience = Math.max(0, Math.floor(experience));
  const level = Math.floor(safeExperience / EXPERIENCE_PER_LEVEL) + 1;
  const currentLevelExperience = safeExperience % EXPERIENCE_PER_LEVEL;

  return {
    level,
    experience: safeExperience,
    currentLevelExperience,
    nextLevelExperience: EXPERIENCE_PER_LEVEL,
    progressPercent: currentLevelExperience
  };
}

export function utcDayRange(now: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}
