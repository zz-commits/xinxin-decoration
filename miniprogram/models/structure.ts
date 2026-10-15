export interface StructureCell {
  id: string;
  name: string;
  widthMm?: number | string;
  heightMm?: number | string;
  opening: string;
  direction: string;
  notes: string;
}
export interface StructureFace {
  id: string;
  name: string;
  widthMm?: number | string;
  heightMm?: number | string;
  corner: string;
  obstacles: string;
  cells: StructureCell[];
}
export interface StructurePlan {
  version: number;
  faces: StructureFace[];
  glass: string;
  hardware: string;
  constraints: string;
}
