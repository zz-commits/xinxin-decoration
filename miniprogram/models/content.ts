export interface ServiceItem {
  _id: string;
  title: string;
  subtitle: string;
  description: string;
  products: string[];
  materials: string[];
  variant: string;
  sortOrder: number;
}

export interface StoreInfo {
  _id: string;
  name: string;
  branchName: string;
  description: string;
  phones: string[];
  wechatId: string;
  wechatQrImage: string;
  address: string;
  businessHours: string;
  dianpingUrl: string;
}

export interface CaseItem {
  _id: string;
  title: string;
  summary: string;
  community: string;
  categoryIds: string[];
  coverImage: string;
  images: string[];
  locations: { name: string; products: string[]; material: string }[];
}

export interface Catalogue {
  store: StoreInfo;
  services: ServiceItem[];
}

export interface ContentResult<T> {
  data: T;
  source: 'cloud' | 'local';
}
