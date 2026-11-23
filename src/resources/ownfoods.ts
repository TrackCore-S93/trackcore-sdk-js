import type { Decimal } from "../decimal.js";
import { decodeDeletionReceipt, decodeFood } from "../decode.js";
import { ValidationError } from "../errors.js";
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
  /**
   * **For an edit only.** In `foods.custom.update` it says which of the food's
   * servings this one replaces, and that serving keeps its id. Leave it out
   * for a serving that is new. `foods.custom.create` ignores it.
   */
  readonly servingId?: string | undefined;
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
  /**
   * An `https` link to a photo of the food, hosted by you. TrackCore keeps the
   * link and returns it as `food.image_url`; it stores no image and never
   * fetches this one. Anything else is `400 food_image_url_invalid`.
   */
  readonly imageUrl?: string | null | undefined;
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
      image_url: params.imageUrl ?? null,
      default_serving_id: params.defaultServingId,
      servings: params.servings.map(servingBody),
    },
    signal: params.signal,
  });
  return decodeFood(response.body);
}

/** One serving as the API reads it. A key left `undefined` is not sent. */
function servingBody(serving: CustomServing): Record<string, unknown> {
  return {
    serving_id: serving.servingId,
    description: serving.description,
    base_quantity: serving.baseQuantity,
    household_unit: serving.householdUnit,
    metric_amount: serving.metricAmount,
    metric_unit: serving.metricUnit,
    gram_weight_per_household_unit: serving.gramWeightPerHouseholdUnit,
    is_metric_default: serving.isMetricDefault,
    carbohydrate_basis: serving.carbohydrateBasis,
    nutrition: serving.nutrition,
  };
}

export interface UpdateCustomFoodParams {
  readonly name?: string | undefined;
  /** `null` removes the brand. Left out, the brand is not touched. */
  readonly brand?: string | null | undefined;
  /** `null` removes the photo. Left out, the photo is not touched. */
  readonly imageUrl?: string | null | undefined;
  /**
   * **The whole list, in the order to show it.** It replaces the list the food
   * has. Give a serving the `servingId` it already has and it keeps that id; a
   * serving with none is new; a serving the food had that is not in the list
   * is removed.
   */
  readonly servings?: readonly CustomServing[] | undefined;
  /** Must be one of the servings the food has once this edit is applied. */
  readonly defaultServingId?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

/**
 * `PATCH /v1/foods/custom/{food_id}` — change a custom food after it was saved.
 *
 * **Only what you pass changes.** `{ name: "Protein bar" }` moves the name and
 * nothing else. Leaving a key out is not the same as passing `null`:
 * `brand: null` removes the brand.
 *
 * Diary entries already logged keep the numbers they were logged with: an
 * entry stores a copy of the food (P-002). A recipe that uses the food keeps
 * the nutrition it was computed with.
 *
 * A recipe cannot be edited here (`400 recipe_not_editable`): its nutrition is
 * computed from its ingredients.
 */
export async function updateCustomFood(
  client: HasTransport,
  foodId: string,
  params: UpdateCustomFoodParams,
): Promise<Food> {
  if (foodId === "") {
    throw new ValidationError("foodId", "updateCustomFood: a food id is required");
  }
  // Built key by key, so a key that was not passed is not in the body at all.
  // `undefined` would be dropped by the encoder anyway; `null` must survive,
  // because it is how a brand or a photo is removed.
  const body: Record<string, unknown> = {};
  if (params.name !== undefined) body["name"] = params.name;
  if (params.brand !== undefined) body["brand"] = params.brand;
  if (params.imageUrl !== undefined) body["image_url"] = params.imageUrl;
  if (params.servings !== undefined) body["servings"] = params.servings.map(servingBody);
  if (params.defaultServingId !== undefined) body["default_serving_id"] = params.defaultServingId;
  if (Object.keys(body).length === 0) {
    // Caught here so it fails at the call site and not after a round trip.
    // The server's `400 custom_food_edit_empty` remains the authority.
    throw new ValidationError(
      "params",
      "updateCustomFood: nothing to change. Pass a name, a brand, an imageUrl, servings or a defaultServingId.",
    );
  }
  const response = await client.transport.request({
    method: "PATCH",
    path: `/v1/foods/custom/${encodeURIComponent(foodId)}`,
    body,
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
  readonly quantity: number | string | Decimal;
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
