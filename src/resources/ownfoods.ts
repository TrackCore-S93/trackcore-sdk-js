import { decodeDeletionReceipt, decodeFood } from "../decode.js";
import type { HasTransport } from "./foods";
import type { Food, DeletionReceipt } from "../models";

/**
 * The end user's own foods: custom foods and recipes.
 *
 * # These come back in the same shape as a provider food
 *
 * DM-F6: all four `food_type` values return the same JSON shape, so the type
 * here is `Food` — the same one `foods.get` returns. That is the point of the
 * criterion: one parser, whether the food came from the provider, a barcode, a
 * label scan or the end user's own kitchen.
 *
 * # Nutrition you send is held to the same standard as the provider's
 *
 * A nutrient value must be a JSON **number**. `"243"` is refused, the same way
 * it is refused from the provider — that is the whole product promise, and it
 * does not get an exception because the string came from the customer.
 *
 * Scale is kept exactly: send `12.400` and `12.400` comes back, because you may
 * have meant three decimal places. A nutrient sent as `null` stays null and
 * never becomes `0`; one you omit is absent, which means "not modelled here".
 */

export interface CustomServing {
  readonly description: string;
  /** How many of this serving the `nutrition` below describes. Usually 1. */
  readonly baseQuantity: number | string;
  readonly householdUnit?: string | undefined;
  readonly metricAmount?: number | string | undefined;
  /** `g` or `ml`. Required when `metricAmount` is set. */
  readonly metricUnit?: "g" | "ml" | undefined;
  readonly gramWeightPerHouseholdUnit?: number | string | undefined;
  readonly isMetricDefault?: boolean | undefined;
  /** `total` or `net`. Defaults to `total`; never derived from fibre. */
  readonly carbohydrateBasis?: "total" | "net" | undefined;
  /** `{"energy":{"value":243,"unit":"kcal"}, …}`. Numbers, never strings. */
  readonly nutrition: Readonly<Record<string, unknown>>;
}

export interface CreateCustomFoodParams {
  readonly name: string;
  readonly brand?: string | null | undefined;
  readonly servings: readonly CustomServing[];
  readonly defaultServingId?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

/** `POST /v1/foods/custom` — define a food of your end user's own. */
export async function createCustomFood(
  client: HasTransport,
  params: CreateCustomFoodParams,
): Promise<Food> {
  const response = await client.transport.request({
    method: "POST",
    path: "/v1/foods/custom",
    body: {
      name: params.name,
      brand: params.brand ?? null,
      default_serving_id: params.defaultServingId,
      servings: params.servings.map((serving) => ({
        description: serving.description,
        base_quantity: serving.baseQuantity,
        household_unit: serving.householdUnit,
        metric_amount: serving.metricAmount,
        metric_unit: serving.metricUnit,
        gram_weight_per_household_unit: serving.gramWeightPerHouseholdUnit,
        is_metric_default: serving.isMetricDefault,
        carbohydrate_basis: serving.carbohydrateBasis,
        nutrition: serving.nutrition,
      })),
    },
    signal: params.signal,
  });
  return decodeFood(response.body);
}

/**
 * `DELETE /v1/foods/custom/{food_id}` — remove one.
 *
 * Past diary entries that used it keep working: an entry stores a copy of the
 * food, not a reference (P-002). Deleting only stops it being logged again.
 */
export async function deleteCustomFood(
  client: HasTransport,
  foodId: string,
  options?: { readonly signal?: AbortSignal | undefined },
): Promise<DeletionReceipt> {
  const response = await client.transport.request({
    method: "DELETE",
    path: `/v1/foods/custom/${encodeURIComponent(foodId)}`,
    signal: options?.signal,
  });
  return decodeDeletionReceipt(response.body);
}

export interface RecipeIngredient {
  readonly foodId: string;
  readonly servingId: string;
  /** How many of that serving goes into the recipe. */
  readonly quantity: number | string;
  readonly note?: string | undefined;
}

export interface CreateRecipeParams {
  readonly name: string;
  readonly brand?: string | null | undefined;
  /** The yield: "this makes 4". Per-serving nutrition is the total over this. */
  readonly recipeServings: number | string;
  readonly directions?: readonly string[] | undefined;
  readonly ingredients: readonly RecipeIngredient[];
  readonly signal?: AbortSignal | undefined;
}

/**
 * `POST /v1/foods/recipes` — a food computed from other foods.
 *
 * Ingredients may be provider foods, the end user's own custom foods, or other
 * recipes. The nutrition is summed server-side across **every** nutrient any
 * ingredient models — a recipe of a 6-nutrient food and a 17-nutrient food
 * carries 17, not 6.
 *
 * `data_quality` comes back `partial` when some ingredient did not model a
 * nutrient the others did, which is the honest signal that a figure in the
 * total counted fewer foods than the recipe has.
 */
export async function createRecipe(client: HasTransport, params: CreateRecipeParams): Promise<Food> {
  const response = await client.transport.request({
    method: "POST",
    path: "/v1/foods/recipes",
    body: {
      name: params.name,
      brand: params.brand ?? null,
      recipe_servings: params.recipeServings,
      directions: params.directions,
      ingredients: params.ingredients.map((ingredient) => ({
        food_id: ingredient.foodId,
        serving_id: ingredient.servingId,
        quantity: ingredient.quantity,
        note: ingredient.note,
      })),
    },
    signal: params.signal,
  });
  return decodeFood(response.body);
}
