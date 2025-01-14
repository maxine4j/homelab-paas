export const daysBetween = (startDate: Date, endDate: Date) => {
  const differenceInMs = endDate.getTime() - startDate.getTime();
  const millisecondsInDay = 1000 * 60 * 60 * 24;

  return Math.abs(Math.floor(differenceInMs / millisecondsInDay));
};
