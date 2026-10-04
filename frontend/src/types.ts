export type Vec2 = { x: number; y: number };
export type Shape = 'circle' | 'box' | 'ramp' | 'wall' | 'platform';
export type Scene = 'incline' | 'collision' | 'empty';
export type Body = {
  id: string;
  label: string;
  shape: Shape;
  static: boolean;
  position: Vec2;
  velocity: Vec2;
  rotation: number;
  angular_velocity: number;
  mass: number;
  friction: number;
  restitution: number;
  width: number;
  height: number;
  radius: number;
};
export type Frame = { tick: number; objects: Body[]; collisions: string[] };
export type WorldState = Frame & {
  type: 'full';
  duration: number;
  playing: boolean;
  speed: number;
  revision: number;
  seed: number;
  scene: Scene;
  environment: { width: number; height: number; gravity: Vec2; dt: number; iterations: number };
};
export type Transform = Pick<
  Body,
  'id' | 'position' | 'velocity' | 'rotation' | 'angular_velocity'
>;
export type FrameMessage = {
  type: 'frame';
  tick: number;
  duration: number;
  playing: boolean;
  speed: number;
  revision: number;
  transforms: Transform[];
  collisions: string[];
};
export type Command = {
  kind: 'play' | 'pause' | 'step' | 'seek' | 'speed' | 'reset' | 'edit' | 'add' | 'remove';
  tick?: number;
  steps?: number;
  speed?: number;
  object_id?: string;
  object?: Body;
  patch?: Partial<Body>;
};
export type Experiment = {
  schema_version: 1;
  engine: string;
  model_version: null;
  created_at: string;
  origin: { seed: number; scene: Scene; objects: Body[] };
  playhead: number;
  duration: number;
};
// Future model responses have a separate source; a physics frame is never an AI prediction.
export type Prediction = {
  source: 'learned_model';
  modelVersion: string;
  frames: Frame[];
  uncertainty?: { method: string; positionStd: Vec2[][] };
};
