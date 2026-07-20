import config from "app-config";

/**
 * Deployment-supplied naming and copy. The shape mirrors profile.example/cabin.config.json;
 * see the "Configuration" section of the README for what each field drives.
 */
export interface Branding {
  appName: string;
  longName: string;
  tagline: string;
  emoji: string;
  propertyNoun: string;
  priorityUserLabel: string;
  priorityUserLabelPossessive: string;
  inviteIntro: string;
}

export const branding = config as Branding;
