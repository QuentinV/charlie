import { RestApis } from "../types";
import recipes from './recipes/api';
import shopping from './shopping/api';

export const apis: RestApis = {
    ...recipes,
    ...shopping
}