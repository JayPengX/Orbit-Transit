// The four parts of Taiwan the station picker is split into (TDX city codes).
export const REGIONS = {
  north: ['Keelung', 'Taipei', 'NewTaipei', 'Taoyuan', 'Hsinchu', 'HsinchuCounty'],
  central: ['MiaoliCounty', 'Taichung', 'ChanghuaCounty', 'NantouCounty', 'YunlinCounty'],
  south: ['ChiayiCounty', 'Chiayi', 'Tainan', 'Kaohsiung', 'PingtungCounty'],
  east: ['YilanCounty', 'HualienCounty', 'TaitungCounty']
};
export const regionOf = city => Object.keys(REGIONS).find(r => REGIONS[r].includes(city)) || 'north';
