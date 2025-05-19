import type { Config } from "../types/index.ts";

export const isInSilentHours = (config: Config): boolean => {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentTime = currentHour * 60 + currentMinute;

  const startParts = config.notification.silentHours.start.split(":");
  const startHour = parseInt(startParts[0]);
  const startMinute = parseInt(startParts[1]);
  const startTime = startHour * 60 + startMinute;

  const endParts = config.notification.silentHours.end.split(":");
  const endHour = parseInt(endParts[0]);
  const endMinute = parseInt(endParts[1]);
  const endTime = endHour * 60 + endMinute;

  // Handle wrap around midnight
  if (startTime > endTime) {
    return currentTime >= startTime || currentTime <= endTime;
  } else {
    return currentTime >= startTime && currentTime <= endTime;
  }
};
