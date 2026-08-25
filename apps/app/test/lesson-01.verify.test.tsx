import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Home } from "../src/routes/index";

describe("lesson 01 completion", () => {
  it("shows the requested copy in a hero layout", () => {
    render(<Home />);
    expect(screen.getByRole("heading", { name: "顧客の声を、次の一手に。" })).toBeInTheDocument();
    expect(screen.queryByText("顧客の声を、事業の前進に。")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveClass("hero");
  });

  it("keeps the completed page free of Lesson 2 UI and extra display copy", () => {
    const { container } = render(<Home />);
    const main = container.querySelector("main");

    expect(main).not.toBeNull();
    if (!main) throw new Error("main must render");

    expect(main.querySelectorAll("button, table")).toHaveLength(0);
    expect(
      [main, ...main.querySelectorAll("*")].filter((element) =>
        ["card", "stats", "btn"].some((className) => element.classList.contains(className)),
      ),
    ).toEqual([]);
    expect(main.textContent).toBe(
      "顧客の声を、次の一手に。顧客の声を、次の行動へつなげる場所です。",
    );
  });
});
