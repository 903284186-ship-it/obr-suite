export const PLUGIN_ID = "com.obr-suite/resources";
export const RESOURCES_KEY = `${PLUGIN_ID}/data`;

export type ResourceType =
  | "count"
  | "bar"
  | "number";

export type IconId =
  | "gem"
  | "heart"
  | "starFour"
  | "starFive"
  | "skull"
  | "hourglass"
  | "catEye"
  | "gear"
  | "swords"
  | "apple"
  | "drumstick"
  | "mask"
  | "cross"
  | "axe"
  | "shield"
  | "fist"
  | "bow"
  | "note"
  | "lute"
  | "dagger"
  | "lightning"
  | "bloodDrop"
  | "leaf"
  | "waterDrop"
  | "spellbook";

export interface Resource {
  id: string;
  name: string;
  type: ResourceType;
  current: number;
  max: number;
  icon: IconId;
  order?: number;
}

export const DEFAULT_RESOURCES: Resource[] = [];
