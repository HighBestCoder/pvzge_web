function includesTutorialOne(levelId) {
  const ids = Array.isArray(levelId) ? levelId : [levelId];
  return ids.some((id) => String(id) === "tutorial1");
}

export function shouldDeferTutorialReward(runtime) {
  return includesTutorialOne(runtime?.levelId) && runtime?.level?.Tutorial_Wave_Stuck === true;
}
